import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import {
	createRedisClient,
	isRedisConfigured,
	type RedisClient,
} from "@psi-opora/bot-core";
import {
	insertBotMessage,
	listBotMessages,
	listTelegramPersonalAccounts,
	listWhatsappPersonalAccounts,
	type MessageDeliveryStatus,
	setWhatsappPersonalAccountStateBySession,
	upsertBitrixCrmLink,
} from "@psi-opora/db/queries";
import { sendOutboundMessageAndWait } from "@psi-opora/tg-userbot";
import {
	jidFromPhone,
	wahaGetSession,
	wahaSendText,
	wahaSessionHealth,
} from "@psi-opora/waha";
import {
	MESSAGE_SENDER_CODES,
	type MessageSenderPayload,
	normalizePhoneDigits,
} from "./message-sender-payload";

/** Статусы messageservice.message.status.update. */
type MessageSenderStatus =
	| "queued"
	| "sent"
	| "delivered"
	| "undelivered"
	| "failed";

const DEDUP_TTL_SECONDS = 24 * 60 * 60;
/** Столько ждём ack WAHA «доставлено», чтобы переслать его в Bitrix. */
const ACK_MAPPING_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Если к порталу подключено несколько номеров — пишем с того, с которого
 * уже шла переписка с этим клиентом, иначе с первого подключённого. */
async function pickAccount<T extends { connectorId: string; status: string }>(
	accounts: T[],
	messenger: string,
	userId: string,
): Promise<T | undefined> {
	const connected = accounts.filter(
		(account) => account.status === "connected",
	);
	if (connected.length <= 1) return connected[0];
	const [last] = await listBotMessages(messenger, userId, 1).catch(() => []);
	return (
		connected.find((account) => account.connectorId === last?.connectorId) ??
		connected[0]
	);
}

interface SendOutcome {
	ok: boolean;
	queued?: boolean;
	error?: string;
	/** ID сообщения в мессенджере — для WhatsApp по нему приходит ack. */
	externalId?: string;
	/** userId диалога в bot_messages (jid / Telegram ID) — чтобы сообщение
	 * попало в тот же тред, что и будущие входящие от клиента. */
	userId: string;
	connectorId?: string;
}

async function sendViaWhatsapp(
	memberId: string,
	phone: string,
	text: string,
): Promise<SendOutcome> {
	const jid = jidFromPhone(phone);
	const account = await pickAccount(
		await listWhatsappPersonalAccounts(memberId),
		"whatsapp-personal",
		jid,
	);
	if (!account) {
		return {
			ok: false,
			userId: jid,
			error: "нет подключённого личного номера WhatsApp",
		};
	}
	try {
		const { id } = await wahaSendText(account.sessionName, jid, text);
		return {
			ok: true,
			externalId: id,
			userId: jid,
			connectorId: account.connectorId,
		};
	} catch (err) {
		const health = wahaSessionHealth(
			await wahaGetSession(account.sessionName).catch(() => null),
		);
		if (health.status !== "connected") {
			await setWhatsappPersonalAccountStateBySession(
				account.sessionName,
				health.status,
				health.error,
			).catch(() => {});
		}
		return {
			ok: false,
			userId: jid,
			connectorId: account.connectorId,
			error: (err as Error).message,
		};
	}
}

async function sendViaTelegram(
	memberId: string,
	phone: string,
	text: string,
): Promise<SendOutcome> {
	const account = await pickAccount(
		await listTelegramPersonalAccounts(memberId),
		"telegram-personal",
		phone,
	);
	if (!account) {
		return {
			ok: false,
			userId: phone,
			error: "нет подключённого личного номера Telegram",
		};
	}
	const result = await sendOutboundMessageAndWait({
		memberId: account.memberId,
		openLineId: account.openLineId,
		connectorId: account.connectorId,
		jobId: crypto.randomUUID(),
		phone,
		text,
	});
	if (!result) {
		return {
			ok: false,
			queued: true,
			userId: phone,
			connectorId: account.connectorId,
		};
	}
	return {
		ok: result.ok,
		error: result.error,
		externalId: result.externalId,
		userId: result.telegramUserId ?? phone,
		connectorId: account.connectorId,
	};
}

export async function updateStatus(
	memberId: string,
	code: string,
	messageId: string,
	status: MessageSenderStatus,
): Promise<void> {
	const api = resolveBitrixApi(memberId);
	if (!api) {
		console.error(
			`[message-sender] нет OAuth-клиента Bitrix для портала ${memberId} — статус ${status} не передан`,
		);
		return;
	}
	try {
		await api.call("messageservice.message.status.update", {
			CODE: code,
			MESSAGE_ID: messageId,
			STATUS: status,
		});
	} catch (err) {
		console.error(
			`[message-sender] не удалось обновить статус ${messageId} → ${status}: ${(err as Error).message}`,
		);
	}
}

function dedupKey(payload: MessageSenderPayload): string {
	return `message-sender:dedup:${payload.memberId}:${payload.messageId}`;
}

function ackKey(externalId: string): string {
	return `message-sender:wa-ack:${externalId}`;
}

interface AckMapping {
	memberId: string;
	code: string;
	messageId: string;
}

function redisOrNull(): RedisClient | null {
	return isRedisConfigured() ? createRedisClient() : null;
}

/** Повторная доставка того же message_id (ретрай Bitrix) не должна
 * отправить клиенту сообщение второй раз. Без Redis работаем fail-open. */
async function claimMessage(payload: MessageSenderPayload): Promise<boolean> {
	const redis = redisOrNull();
	if (!redis) return true;
	try {
		return (
			(await redis.set(dedupKey(payload), true, {
				nx: true,
				ex: DEDUP_TTL_SECONDS,
			})) === "OK"
		);
	} catch (err) {
		console.error(
			`[message-sender] не удалось проверить идемпотентность: ${(err as Error).message}`,
		);
		return true;
	}
}

/**
 * Отправляет сообщение, пришедшее от провайдера CRM, с личного номера,
 * журналирует его в bot_messages (видно в едином инбоксе и во вкладке
 * «Мессенджер») и сообщает Bitrix статус. Ответ клиента придёт обычным
 * путём — в Открытую линию этого номера.
 */
export async function handleMessageSenderPayload(
	payload: MessageSenderPayload,
): Promise<void> {
	if (!(await claimMessage(payload))) {
		console.log(
			`[message-sender] повторная доставка ${payload.messageId} пропущена`,
		);
		return;
	}

	const messenger = MESSAGE_SENDER_CODES[payload.code];
	const phone = normalizePhoneDigits(payload.to);
	if (!phone) {
		console.warn(
			`[message-sender] некорректный номер получателя «${payload.to}» (${payload.messageId})`,
		);
		await updateStatus(
			payload.memberId,
			payload.code,
			payload.messageId,
			"undelivered",
		);
		return;
	}

	const outcome =
		messenger === "whatsapp-personal"
			? await sendViaWhatsapp(payload.memberId, phone, payload.text)
			: await sendViaTelegram(payload.memberId, phone, payload.text);

	if (outcome.ok) {
		console.log(
			`[message-sender] ${messenger}: отправлено ${payload.messageId} на ${phone}`,
		);
	} else if (outcome.queued) {
		console.log(
			`[message-sender] ${messenger}: ожидается ответ воркера для ${payload.messageId} на ${phone}`,
		);
	} else {
		console.error(
			`[message-sender] ${messenger}: не отправлено ${payload.messageId} на ${phone}: ${outcome.error}`,
		);
	}

	const status: MessageDeliveryStatus = outcome.queued
		? "queued"
		: outcome.ok
			? "sent"
			: "failed";
	await insertBotMessage({
		messenger,
		userId: outcome.userId,
		direction: "out",
		source: "widget",
		text: payload.text,
		status,
		externalId: outcome.externalId,
		externalChatId:
			messenger === "telegram-personal" && outcome.userId !== phone
				? outcome.userId
				: undefined,
		connectorId: outcome.connectorId,
	}).catch((err) =>
		console.error(
			`[message-sender] не удалось записать сообщение в журнал: ${(err as Error).message}`,
		),
	);

	// Bitrix уже знает контакт — связываем сразу, чтобы ответ клиента в
	// Открытой линии открылся в той же карточке (как во вкладке «Мессенджер»).
	if (outcome.ok && payload.contactId) {
		const contactId = payload.contactId;
		const userIds = new Set([phone, outcome.userId]);
		await Promise.all(
			[...userIds].map((userId) =>
				upsertBitrixCrmLink({
					messenger,
					userId,
					contactId,
					dealId: payload.dealId,
				}),
			),
		).catch((err) =>
			console.error(
				`[message-sender] не удалось сохранить CRM-связь: ${(err as Error).message}`,
			),
		);
	}

	if (outcome.ok && outcome.externalId && messenger === "whatsapp-personal") {
		const mapping: AckMapping = {
			memberId: payload.memberId,
			code: payload.code,
			messageId: payload.messageId,
		};
		await redisOrNull()
			?.set(ackKey(outcome.externalId), mapping, {
				ex: ACK_MAPPING_TTL_SECONDS,
			})
			.catch((err) =>
				console.error(
					`[message-sender] не удалось сохранить связку для ack: ${(err as Error).message}`,
				),
			);
	}

	await updateStatus(payload.memberId, payload.code, payload.messageId, status);
}

/**
 * Ack WAHA (message.ack) для сообщения, отправленного через провайдер CRM, —
 * пересылаем «доставлено» в Bitrix, чтобы в таймлайне CRM статус сменился
 * с «отправлено». Для остальных сообщений ничего не делает.
 */
export async function forwardWhatsappAckToMessageSender(
	externalId: string,
	status: MessageDeliveryStatus,
): Promise<void> {
	if (status !== "delivered" && status !== "read" && status !== "failed")
		return;
	const redis = redisOrNull();
	if (!redis) return;
	const mapping = await redis
		.get<AckMapping>(ackKey(externalId))
		.catch(() => null);
	if (!mapping) return;
	await redis.del(ackKey(externalId)).catch(() => {});
	await updateStatus(
		mapping.memberId,
		mapping.code,
		mapping.messageId,
		status === "failed" ? "undelivered" : "delivered",
	);
}
