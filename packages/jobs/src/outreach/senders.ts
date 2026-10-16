import type { OutreachSender, SendOutcome } from "./cascade";

/**
 * Реальные отправители каскада — личные номера MAX/Telegram (через очереди
 * always-on воркеров в Redis) и WhatsApp (WAHA по REST). Пакеты userbot'ов
 * импортируются лениво: mtcute и протокол MAX нужны только при запуске
 * рассылки, а не при индексации задач Hatchet.
 */

export interface PersonalAccountRef {
	memberId: string;
	openLineId: string;
	connectorId: string;
}

/** Сколько ждём ответа воркера до попытки снять задачу из очереди. */
const WORKER_REPLY_TIMEOUT_MS = 30_000;
/** Сколько ещё ждём, если воркер уже забрал задачу (резолв номера бывает медленным). */
const WORKER_TAKEN_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 500;

async function pollFor<T>(
	read: () => Promise<T | null>,
	timeoutMs: number,
): Promise<T | null> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = await read();
		if (value) return value;
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
	}
	return null;
}

/**
 * Ожидание результата задачи воркера без риска дубля: не дождавшись ответа,
 * снимаем задачу из очереди. Снялась — воркер её не видел (не запущен или
 * завис), канал считаем упавшим. Не снялась — воркер её уже взял, ждём ещё;
 * если и тогда нет ответа — статус неизвестен, каскад дальше не идёт.
 */
async function awaitWorker<R>(params: {
	label: string;
	read: () => Promise<R | null>;
	cancel: () => Promise<boolean>;
}): Promise<{ result: R } | { outcome: SendOutcome }> {
	const first = await pollFor(params.read, WORKER_REPLY_TIMEOUT_MS);
	if (first) return { result: first };
	if (await params.cancel()) {
		return {
			outcome: {
				kind: "channel_down",
				error: `Воркер ${params.label} не ответил — проверьте, что он запущен`,
			},
		};
	}
	const late = await pollFor(params.read, WORKER_TAKEN_TIMEOUT_MS);
	if (late) return { result: late };
	return {
		outcome: {
			kind: "unknown",
			error: `Воркер ${params.label} взял сообщение, но не подтвердил отправку`,
		},
	};
}

/** Ошибки, после которых номер Telegram лучше не трогать до конца рассылки. */
const TELEGRAM_DOWN_RE =
	/FLOOD|PEER_FLOOD|wait of \d+ seconds|AUTH_KEY|SESSION_REVOKED|USER_DEACTIVATED|PHONE_NUMBER_BANNED/i;

export function classifyTelegramError(error: string): SendOutcome {
	if (
		/не найден в Telegram|PHONE_NOT_OCCUPIED|USERNAME_NOT_OCCUPIED/i.test(error)
	)
		return { kind: "not_found", error };
	if (TELEGRAM_DOWN_RE.test(error)) return { kind: "channel_down", error };
	return { kind: "failed", error };
}

export function classifyMaxError(error: string): SendOutcome {
	if (/не нашёл контакт|not.?found/i.test(error))
		return { kind: "not_found", error };
	if (/не вернул профиль|flood|too many|limit/i.test(error))
		return { kind: "channel_down", error };
	return { kind: "failed", error };
}

export function createMaxSender(account: PersonalAccountRef): OutreachSender {
	return {
		channel: "max",
		async send(phone, text) {
			const {
				cancelMaxOutboundMessage,
				getMaxSendResult,
				pushMaxOutboundMessage,
			} = await import("@psi-opora/max-userbot");
			const message = {
				...account,
				jobId: crypto.randomUUID(),
				phone,
				text,
			};
			await pushMaxOutboundMessage(message);
			const waited = await awaitWorker({
				label: "личного MAX (apps/max-userbot-worker)",
				read: () => getMaxSendResult(message.jobId),
				cancel: () => cancelMaxOutboundMessage(message),
			});
			if ("outcome" in waited) return waited.outcome;
			const { result } = waited;
			if (result.ok && result.chatId) {
				return {
					kind: "sent",
					userId: result.chatId,
					externalId: result.externalId,
				};
			}
			if (result.ok) {
				// Воркер старой версии не возвращает chatId — сообщение ушло,
				// просто без ключа диалога для журнала.
				return { kind: "sent", userId: phone, externalId: result.externalId };
			}
			return classifyMaxError(result.error ?? "неизвестная ошибка MAX");
		},
	};
}

export function createTelegramSender(
	account: PersonalAccountRef,
): OutreachSender {
	return {
		channel: "telegram",
		async send(phone, text) {
			const { cancelOutboundMessage, getSendResult, pushOutboundMessage } =
				await import("@psi-opora/tg-userbot");
			const message = {
				...account,
				jobId: crypto.randomUUID(),
				phone,
				text,
			};
			await pushOutboundMessage(message);
			const waited = await awaitWorker({
				label: "личного Telegram (apps/tg-userbot-worker)",
				read: () => getSendResult(message.jobId),
				cancel: () => cancelOutboundMessage(message),
			});
			if ("outcome" in waited) return waited.outcome;
			const { result } = waited;
			if (result.ok) {
				return {
					kind: "sent",
					userId: result.telegramUserId ?? phone,
					externalId: result.externalId,
				};
			}
			return classifyTelegramError(
				result.error ?? "неизвестная ошибка Telegram",
			);
		},
	};
}

export function createWhatsappSender(
	account: PersonalAccountRef,
): OutreachSender {
	return {
		channel: "whatsapp",
		async send(phone, text) {
			const { getWhatsappPersonalAccountByConnector } = await import(
				"@psi-opora/db/queries"
			);
			const { jidFromPhone, wahaCheckNumberExists, wahaSendText } =
				await import("@psi-opora/waha");

			const row = await getWhatsappPersonalAccountByConnector(
				account.connectorId,
				account.openLineId,
			);
			// limited — WhatsApp временно запретил номеру писать новым контактам.
			if (row?.status !== "connected") {
				return {
					kind: "channel_down",
					error: row
						? `Личный WhatsApp ${row.phone} недоступен (${row.status})`
						: "Личный номер WhatsApp отключён",
				};
			}

			let chatId: string;
			try {
				const check = await wahaCheckNumberExists(row.sessionName, phone);
				if (!check.exists) {
					return { kind: "not_found", error: "Номера нет в WhatsApp" };
				}
				chatId = check.chatId ?? jidFromPhone(phone);
			} catch (err) {
				return { kind: "channel_down", error: (err as Error).message };
			}

			try {
				const { id } = await wahaSendText(row.sessionName, chatId, text);
				return { kind: "sent", userId: chatId, externalId: id };
			} catch (err) {
				const error = (err as Error).message;
				// wahaSendText проверяет сессию до и после отправки: ошибка «после»
				// значит, что WAHA команду приняла — сообщение могло уйти.
				if (/сразу после отправки/.test(error)) {
					return { kind: "unknown", error };
				}
				if (/не готова к отправке/.test(error)) {
					return { kind: "channel_down", error };
				}
				return { kind: "failed", error };
			}
		},
	};
}
