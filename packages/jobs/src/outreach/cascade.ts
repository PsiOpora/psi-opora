/**
 * Каскад каналов мультиканальной рассылки по списку: сообщение пробуется
 * через личные номера по приоритету MAX → Telegram → WhatsApp, а если ни
 * один мессенджер не доставил — получатель уходит в email-фазу (письмо
 * отправляет обычная email-кампания, см. hatchet/outreach.ts).
 *
 * Модуль без побочных эффектов: отправители передаются снаружи, поэтому
 * правила каскада покрыты тестами без Redis/WAHA/воркеров.
 */

export type MessengerChannel = "max" | "telegram" | "whatsapp";

export const MESSENGER_PRIORITY: readonly MessengerChannel[] = [
	"max",
	"telegram",
	"whatsapp",
];

/**
 * Итог попытки в одном канале:
 * - sent — доставлено мессенджеру; userId — ключ диалога для журнала;
 * - not_found — у получателя нет аккаунта в этом мессенджере;
 * - failed — отправка не удалась, пробуем следующий канал;
 * - channel_down — канал неработоспособен (воркер не запущен, номер в
 *   флуд-бане): следующий канал, и до конца запуска этот канал не трогаем;
 * - unknown — сообщение могло уйти, но подтверждения нет: каскад
 *   останавливается, чтобы человек не получил его дважды.
 */
export type SendOutcome =
	| { kind: "sent"; userId: string; externalId?: string }
	| { kind: "not_found"; error: string }
	| { kind: "failed"; error: string }
	| { kind: "channel_down"; error: string }
	| { kind: "unknown"; error: string };

export interface OutreachSender {
	channel: MessengerChannel;
	send(phone: string, text: string): Promise<SendOutcome>;
}

export interface CascadeAttempt {
	channel: MessengerChannel | "email";
	ok: boolean;
	error?: string;
	at: string;
}

export type CascadeResult =
	| {
			status: "sent";
			channel: MessengerChannel;
			userId: string;
			externalId?: string;
			attempts: CascadeAttempt[];
	  }
	| { status: "email_pending"; attempts: CascadeAttempt[] }
	| { status: "failed" | "unknown"; error: string; attempts: CascadeAttempt[] };

export async function runCascade(params: {
	phone: string | null;
	email: string | null;
	text: string;
	/** Уже в порядке приоритета; выключенные при запуске каналы сюда не входят. */
	senders: OutreachSender[];
	/** Каналы, признанные неработающими в этом запуске (дополняется здесь). */
	disabled: Set<MessengerChannel>;
	emailEnabled: boolean;
	now?: () => Date;
}): Promise<CascadeResult> {
	const now = params.now ?? (() => new Date());
	const attempts: CascadeAttempt[] = [];
	let lastError: string | null = null;

	if (params.phone) {
		for (const sender of params.senders) {
			if (params.disabled.has(sender.channel)) continue;
			let outcome: SendOutcome;
			try {
				outcome = await sender.send(params.phone, params.text);
			} catch (err) {
				outcome = { kind: "failed", error: (err as Error).message };
			}
			const at = now().toISOString();
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
			if (outcome.kind === "channel_down") params.disabled.add(sender.channel);
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

/** Пауза между отправками с разбросом ±25% — ровный ритм похож на бота. */
export function jitteredDelayMs(
	intervalSec: number,
	random: () => number = Math.random,
): number {
	return Math.round(intervalSec * 1000 * (0.75 + random() * 0.5));
}
