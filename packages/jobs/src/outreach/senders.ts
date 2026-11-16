import type { CardTargets } from "./card-targets";
import type { OutreachSender, SendOutcome } from "./cascade";

/**
 * Реальные отправители каскада — личные номера MAX/Telegram (через очереди
 * always-on воркеров в Redis) и WhatsApp (WAHA по REST); боты — в
 * bot-sender.ts. Пакеты userbot'ов импортируются лениво: mtcute и протокол
 * MAX нужны только при запуске рассылки, а не при индексации задач Hatchet.
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
	if (TELEGRAM_DOWN_RE.test(error))
		return { kind: "channel_down", error, fatal: true };
	return { kind: "failed", error };
}

export function classifyMaxError(error: string): SendOutcome {
	if (/не нашёл контакт|not.?found/i.test(error))
		return { kind: "not_found", error };
	if (/не вернул профиль|flood|too many requests|rate.?limit/i.test(error))
		return { kind: "channel_down", error, fatal: true };
	return { kind: "failed", error };
}

type NotFoundOutcome = Extract<SendOutcome, { kind: "not_found" }>;

/**
 * Итог повторной попытки по аккаунту из карточки контакта. Отправилось —
 * помечаем viaCard. «Могло уйти» и сбой канала возвращаем как есть (каскад
 * должен остановиться/выключить канал). Остальное — в ошибке обе причины:
 * и почему не нашёлся по номеру, и почему не вышло по карточке.
 */
export function combineCardOutcome(
	first: NotFoundOutcome,
	retry: SendOutcome,
): SendOutcome {
	if (retry.kind === "sent") return { ...retry, viaCard: true };
	if (retry.kind === "unknown" || retry.kind === "channel_down") return retry;
	return {
		...retry,
		error: `${first.error}; по аккаунту из карточки контакта: ${retry.error}`,
	};
}

/** Ничего не нашлось и в карточке — объясняем в отчёте, что её тоже смотрели. */
function noCardAccount(
	first: NotFoundOutcome,
	cardError: string | undefined,
): NotFoundOutcome {
	return {
		...first,
		error: `${first.error}; ${cardError ?? "в карточке контакта в CRM аккаунта нет"}`,
	};
}

export function createMaxSender(
	account: PersonalAccountRef,
	/** Запасной поиск аккаунта в карточке CRM, когда по телефону не нашли. */
	findCardTargets?: (phone: string) => Promise<CardTargets>,
): OutreachSender {
	const dispatch = async (
		target: { phone: string } | { maxUserId: string },
		text: string,
	): Promise<SendOutcome> => {
		const {
			cancelMaxOutboundMessage,
			getMaxSendResult,
			pushMaxOutboundMessage,
		} = await import("@psi-opora/max-userbot");
		const message = {
			...account,
			jobId: crypto.randomUUID(),
			...target,
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
			const key = "phone" in target ? target.phone : target.maxUserId;
			return { kind: "sent", userId: key, externalId: result.externalId };
		}
		return classifyMaxError(result.error ?? "неизвестная ошибка MAX");
	};

	return {
		channel: "max",
		async send(phone, text) {
			const outcome = await dispatch({ phone }, text);
			if (outcome.kind !== "not_found" || !findCardTargets) return outcome;

			const card = await findCardTargets(phone);
			if (!card.max) return noCardAccount(outcome, card.error);
			return combineCardOutcome(
				outcome,
				await dispatch({ maxUserId: card.max }, text),
			);
		},
	};
}

export function createTelegramSender(
	account: PersonalAccountRef,
	/** Запасной поиск аккаунта в карточке CRM, когда по телефону не нашли. */
	findCardTargets?: (phone: string) => Promise<CardTargets>,
): OutreachSender {
	const dispatch = async (
		target:
			| { phone: string }
			| { telegramUserId: number }
			| { telegramUsername: string },
		text: string,
		fallbackKey: string,
	): Promise<SendOutcome> => {
		const { cancelOutboundMessage, getSendResult, pushOutboundMessage } =
			await import("@psi-opora/tg-userbot");
		const message = {
			...account,
			jobId: crypto.randomUUID(),
			...target,
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
				userId: result.telegramUserId ?? fallbackKey,
				externalId: result.externalId,
			};
		}
		return classifyTelegramError(result.error ?? "неизвестная ошибка Telegram");
	};

	return {
		channel: "telegram",
		async send(phone, text) {
			const outcome = await dispatch({ phone }, text, phone);
			if (outcome.kind !== "not_found" || !findCardTargets) return outcome;

			const card = await findCardTargets(phone);
			const telegram = card.telegram;
			// Числовой ID надёжнее username: username можно сменить или скрыть.
			const userId = telegram?.userId ? Number(telegram.userId) : null;
			if (userId !== null && Number.isSafeInteger(userId)) {
				return combineCardOutcome(
					outcome,
					await dispatch({ telegramUserId: userId }, text, String(userId)),
				);
			}
			if (telegram?.username) {
				return combineCardOutcome(
					outcome,
					await dispatch(
						{ telegramUsername: telegram.username },
						text,
						telegram.username,
					),
				);
			}
			return noCardAccount(outcome, card.error);
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
					fatal: true,
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
