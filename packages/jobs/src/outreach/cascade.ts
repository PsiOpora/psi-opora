/**
 * Каскад каналов мультиканальной рассылки по списку: сообщение пробуется
 * через личные номера в заданном порядке (по умолчанию MAX → Telegram →
 * WhatsApp), а если ни один мессенджер не доставил — получатель уходит в
 * email-фазу (письмо отправляет обычная email-кампания, см. hatchet/outreach.ts).
 *
 * Модуль без побочных эффектов: отправители передаются снаружи, поэтому
 * правила каскада покрыты тестами без Redis/WAHA/воркеров.
 */

export type MessengerChannel = "max" | "telegram" | "whatsapp";

/**
 * Итог попытки в одном канале:
 * - sent — доставлено мессенджеру; userId — ключ диалога для журнала;
 * - not_found — у получателя нет аккаунта в этом мессенджере;
 * - failed — отправка не удалась, пробуем следующий канал;
 * - channel_down — канал не смог обработать сообщение (воркер не ответил,
 *   WAHA недоступна, номер в флуд-бане): пробуем следующий канал. fatal —
 *   канал точно не заработает до конца запуска (флуд-бан, номер отключён) и
 *   выключается сразу; иначе — только после нескольких сбоев подряд (см.
 *   ChannelBreaker), чтобы разовая задержка воркера не ломала приоритет;
 * - unknown — сообщение могло уйти, но подтверждения нет: каскад
 *   останавливается, чтобы человек не получил его дважды.
 */
export type SendOutcome =
	| { kind: "sent"; userId: string; externalId?: string }
	| { kind: "not_found"; error: string }
	| { kind: "failed"; error: string }
	| { kind: "channel_down"; error: string; fatal?: boolean }
	| { kind: "unknown"; error: string };

export interface OutreachSender {
	channel: MessengerChannel;
	send(phone: string, text: string): Promise<SendOutcome>;
}

export interface CascadeAttempt {
	channel: MessengerChannel | "email";
	ok: boolean;
	error?: string;
	/** Канал пропущен без отправки (исчерпан дневной лимит номера). */
	skipped?: boolean;
	at: string;
}

/**
 * Решение перед попыткой в канал (темп, лимиты — см. pacing.ts):
 * go — можно отправлять (нужная пауза уже выдержана); skip — канал сейчас
 * недоступен, пробуем следующий; stop — каскад прерывается (отмена,
 * задача передаёт эстафету), получатель продолжит с этого канала позже.
 */
export type GateDecision =
	| { kind: "go" }
	| { kind: "skip"; reason: string }
	| { kind: "stop" };

export type CascadeResult =
	| {
			status: "sent";
			channel: MessengerChannel;
			userId: string;
			externalId?: string;
			attempts: CascadeAttempt[];
	  }
	| { status: "email_pending"; attempts: CascadeAttempt[] }
	| { status: "interrupted"; attempts: CascadeAttempt[] }
	| { status: "failed" | "unknown"; error: string; attempts: CascadeAttempt[] };

/** Сколько сбоев канала подряд выключают его до конца запуска. */
export const CHANNEL_DOWN_STRIKES = 3;

/**
 * Состояние каналов в пределах одного запуска рассылки: какие каналы
 * выключены и сколько нефатальных сбоев подряд у каждого. Любой ответ
 * канала, кроме сбоя (отправлено, нет такого номера, ошибка отправки),
 * доказывает, что канал жив, и обнуляет счётчик.
 */
export class ChannelBreaker {
	private readonly strikes = new Map<MessengerChannel, number>();
	private readonly disabled = new Set<MessengerChannel>();

	constructor(private readonly threshold = CHANNEL_DOWN_STRIKES) {}

	isDisabled(channel: MessengerChannel): boolean {
		return this.disabled.has(channel);
	}

	recordDown(channel: MessengerChannel, fatal: boolean): void {
		const strikes = (this.strikes.get(channel) ?? 0) + 1;
		this.strikes.set(channel, strikes);
		if (fatal || strikes >= this.threshold) this.disabled.add(channel);
	}

	recordAlive(channel: MessengerChannel): void {
		this.strikes.delete(channel);
	}
}

export async function runCascade(params: {
	phone: string | null;
	email: string | null;
	text: string;
	/** Уже в порядке приоритета; выключенные при запуске каналы сюда не входят. */
	senders: OutreachSender[];
	/** Состояние каналов в этом запуске (обновляется здесь). */
	breaker: ChannelBreaker;
	emailEnabled: boolean;
	/** Попытки прошлого, прерванного запуска — эти каналы повторно не пробуем. */
	previousAttempts?: CascadeAttempt[];
	/** Вызывается перед каждой попыткой; attempts — уже сделанные попытки этого получателя. */
	gate?: (
		channel: MessengerChannel,
		attempts: CascadeAttempt[],
	) => Promise<GateDecision>;
	now?: () => Date;
}): Promise<CascadeResult> {
	const now = params.now ?? (() => new Date());
	const attempts: CascadeAttempt[] = [...(params.previousAttempts ?? [])];
	const tried = new Set(attempts.map((a) => a.channel));
	let lastError: string | null =
		[...attempts].reverse().find((a) => !a.ok)?.error ?? null;

	if (params.phone) {
		for (const sender of params.senders) {
			if (tried.has(sender.channel)) continue;
			if (params.breaker.isDisabled(sender.channel)) continue;
			const decision = params.gate
				? await params.gate(sender.channel, [...attempts])
				: ({ kind: "go" } as const);
			if (decision.kind === "stop") {
				return { status: "interrupted", attempts };
			}
			if (decision.kind === "skip") {
				attempts.push({
					channel: sender.channel,
					ok: false,
					skipped: true,
					error: decision.reason,
					at: now().toISOString(),
				});
				lastError = decision.reason;
				continue;
			}
			let outcome: SendOutcome;
			try {
				outcome = await sender.send(params.phone, params.text);
			} catch (err) {
				outcome = { kind: "failed", error: (err as Error).message };
			}
			const at = now().toISOString();
			if (outcome.kind === "channel_down") {
				params.breaker.recordDown(sender.channel, outcome.fatal === true);
			} else {
				params.breaker.recordAlive(sender.channel);
			}
			if (outcome.kind === "sent") {
				attempts.push({ channel: sender.channel, ok: true, at });
				return {
					status: "sent",
					channel: sender.channel,
					userId: outcome.userId,
					externalId: outcome.externalId,
					attempts,
				};
			}
			attempts.push({
				channel: sender.channel,
				ok: false,
				error: outcome.error,
				at,
			});
			lastError = outcome.error;
			if (outcome.kind === "unknown") {
				return { status: "unknown", error: outcome.error, attempts };
			}
		}
	}

	if (params.emailEnabled && params.email) {
		return { status: "email_pending", attempts };
	}

	let error: string;
	if (!params.phone && !params.email) error = "Нет ни телефона, ни email";
	else if (!params.phone && !params.emailEnabled)
		error = "Нет телефона, а отправка по email выключена";
	else if (lastError)
		error = params.email
			? `Мессенджеры не сработали (${lastError}), а отправка по email выключена`
			: `Мессенджеры не сработали (${lastError}), email нет`;
	else error = "Нет доступных каналов для этого контакта";
	return { status: "failed", error, attempts };
}

/** Подстановка {{name}} — имя из списка; без имени плейсхолдер убирается. */
export function personalizeMessage(text: string, name: string | null): string {
	const value = name?.trim() ?? "";
	if (value) return text.replace(/\{\{\s*name\s*\}\}/g, value);
	// «Здравствуйте, {{name}}!» без имени → «Здравствуйте!»
	return text
		.replace(/[ \t]*,?[ \t]*\{\{\s*name\s*\}\}/g, "")
		.replace(/[ \t]{2,}/g, " ");
}
