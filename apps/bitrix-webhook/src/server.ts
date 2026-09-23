import { createHmac, timingSafeEqual } from "node:crypto";
import { serve } from "@hono/node-server";
import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import {
	bitrixWebhookHandler,
	type ConnectorDisabledInfo,
	type OperatorReplyMessage,
} from "@psi-opora/bitrix-webhook-api";
import {
	consumeOperatorMirrorEcho,
	createRedisClient,
	isRedisConfigured,
	type RedisClient,
} from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import {
	assignConversationIfUnassigned,
	getMaxPersonalAccountByConnector,
	getTelegramPersonalAccountByConnector,
	getWhatsappPersonalAccountByConnector,
	getWhatsappPersonalAccountBySession,
	insertBotMessage,
	type MessageDeliveryStatus,
	removeBotConnector,
	removeWhatsappPersonalAccount,
	setWhatsappPersonalAccountStateBySession,
	updateBotMessageStatus,
	upsertBotUser,
	upsertBotUserPresence,
} from "@psi-opora/db/queries";
import {
	handleConsultationDealUpdate,
	handleDiagnosticDealUpdate,
	handleStageConsentTrigger,
	type Messenger,
	removeSyncedDeal,
	sendMessengerMessage,
	syncOneDeal,
} from "@psi-opora/jobs";
import { pushMaxOutboundMessage } from "@psi-opora/max-userbot";
import { pushOutboundMessage } from "@psi-opora/tg-userbot";
import {
	phoneFromJid,
	wahaAckToStatus,
	wahaDeleteSession,
	wahaGetChatPresence,
	wahaGetSession,
	wahaSendText,
	wahaSessionHealth,
} from "@psi-opora/waha";
import { Hono } from "hono";
import { uploadWahaMedia } from "./media-storage";
import {
	forwardWhatsappAckToMessageSender,
	handleMessageSenderPayload,
} from "./message-sender";
import { parseMessageSenderForm } from "./message-sender-payload";
import {
	claimOperatorReply,
	isMirroredOperatorReply,
} from "./operator-reply-guard";
import { handlePayformWebhook } from "./payform-webhook";

const operatorReplyRedis: RedisClient | null = isRedisConfigured()
	? createRedisClient()
	: null;

// Совпадает с CONNECTOR_IDS в packages/api/src/routers/bot-connector/helpers.ts —
// по CONNECTOR из события определяем, какому боту переслать ответ оператора.
function messengerByConnector(connector: string | undefined): Messenger | null {
	if (!connector) return null;
	if (connector === (process.env.TG_BITRIX_CONNECTOR_ID ?? "psiopora_tg_bot"))
		return "telegram";
	if (connector === (process.env.MAX_BITRIX_CONNECTOR_ID ?? "psiopora_max_bot"))
		return "max";
	return null;
}

/**
 * Журналирует ответ оператора в bot_messages (виден в едином инбоксе
 * дашборда, apps/dashboard/src/app/(dashboard)/clients) и, если у диалога
 * ещё нет ответственного, назначает ответившего оператора — «первый
 * ответивший — ответственный», как в Wazzup. Ошибка здесь не должна
 * блокировать доставку ответа клиенту, поэтому только логируется.
 */
async function logOperatorReply(
	messenger: string,
	reply: OperatorReplyMessage,
	externalId?: string,
	status?: MessageDeliveryStatus,
	messageId = crypto.randomUUID(),
): Promise<string> {
	const userId = String(reply.chatId);
	try {
		await insertBotMessage({
			id: messageId,
			messenger,
			userId,
			direction: "out",
			source: "operator",
			text: reply.text,
			operatorId:
				reply.operatorUserId !== undefined
					? String(reply.operatorUserId)
					: undefined,
			externalId,
			externalChatId:
				messenger === "telegram-personal" || messenger === "max-personal"
					? userId
					: undefined,
			bitrixMessageId: reply.bitrixMessageId,
			status,
			connectorId: reply.connector,
		});
	} catch (err) {
		console.error(
			`[bitrix-webhook] не удалось записать ответ оператора в журнал: ${(err as Error).message}`,
		);
	}

	if (reply.operatorUserId === undefined) return messageId;
	try {
		await assignConversationIfUnassigned({
			messenger,
			userId,
			operatorId: String(reply.operatorUserId),
			operatorName: `Оператор #${reply.operatorUserId}`,
		});
	} catch (err) {
		console.error(
			`[bitrix-webhook] не удалось назначить ответственного по ответу оператора: ${(err as Error).message}`,
		);
	}
	return messageId;
}

/**
 * Ответ оператора для личного Telegram-номера (packages/tg-userbot) не
 * шлём напрямую — этот процесс стейтлес и не держит живой MTProto-клиент.
 * Кладём в Redis-очередь (см. outbox.ts) — apps/tg-userbot-worker вычитывает
 * её и отправляет через уже подключённый клиент того самого номера.
 */
async function relayToTelegramPersonal(
	reply: OperatorReplyMessage,
): Promise<boolean> {
	if (!reply.connector || !reply.lineId) return false;

	const account = await getTelegramPersonalAccountByConnector(
		reply.connector,
		String(reply.lineId),
	);
	if (!account) {
		// Совпадает с нашим префиксом, но записи в БД нет — реальная нестыковка
		// (например, коннектор отключили прямо в Bitrix, минуя наш disconnect),
		// а не просто «это не наш мессенджер» (для чужих коннекторов молчим).
		if (reply.connector.startsWith(env.TG_USERBOT_CONNECTOR_ID)) {
			console.warn(
				`[bitrix-webhook] не найден личный номер Telegram для коннектора ${reply.connector} линии ${reply.lineId}`,
			);
		}
		return false;
	}

	const journalMessageId = await logOperatorReply(
		"telegram-personal",
		reply,
		undefined,
		"sent",
	);
	await pushOutboundMessage({
		memberId: account.memberId,
		openLineId: account.openLineId,
		connectorId: account.connectorId,
		jobId: crypto.randomUUID(),
		telegramUserId: Number(reply.chatId),
		text: reply.text,
		journalMessageId,
	});
	console.log(
		`[bitrix-webhook] ответ оператора поставлен в очередь личного номера ${account.phone} chat=${reply.chatId}`,
	);
	return true;
}

/** Ответ оператора для личного MAX ставится в очередь always-on воркера. */
async function relayToMaxPersonal(
	reply: OperatorReplyMessage,
): Promise<boolean> {
	if (!reply.connector || !reply.lineId) return false;
	const account = await getMaxPersonalAccountByConnector(
		reply.connector,
		String(reply.lineId),
	);
	if (!account) {
		if (reply.connector.startsWith(env.MAX_USERBOT_CONNECTOR_ID)) {
			console.warn(
				`[bitrix-webhook] не найден личный номер MAX для коннектора ${reply.connector} линии ${reply.lineId}`,
			);
		}
		return false;
	}

	const chatId = String(reply.chatId).trim();
	if (!/^\d+$/.test(chatId)) {
		console.error(`[bitrix-webhook] некорректный MAX chatId: ${reply.chatId}`);
		return false;
	}
	const journalMessageId = await logOperatorReply(
		"max-personal",
		reply,
		undefined,
		"sent",
	);
	await pushMaxOutboundMessage({
		memberId: account.memberId,
		openLineId: account.openLineId,
		connectorId: account.connectorId,
		jobId: crypto.randomUUID(),
		chatId,
		text: reply.text,
		journalMessageId,
	});
	console.log(
		`[bitrix-webhook] ответ оператора поставлен в очередь личного MAX ${account.phone} chat=${reply.chatId}`,
	);
	return true;
}

/**
 * Ответ оператора для личного WhatsApp-номера шлём синхронно через REST
 * WAHA — в отличие от Telegram (relayToTelegramPersonal) очередь не нужна:
 * живое соединение с WhatsApp держит контейнер WAHA, а не наш процесс.
 */
async function relayToWhatsAppPersonal(
	reply: OperatorReplyMessage,
): Promise<boolean> {
	if (!reply.connector || !reply.lineId) return false;

	const account = await getWhatsappPersonalAccountByConnector(
		reply.connector,
		String(reply.lineId),
	);
	if (!account) {
		if (reply.connector.startsWith(env.WA_PERSONAL_CONNECTOR_ID)) {
			console.warn(
				`[bitrix-webhook] не найден личный номер WhatsApp для коннектора ${reply.connector} линии ${reply.lineId}`,
			);
		}
		return false;
	}

	let externalId: string | undefined;
	let status: MessageDeliveryStatus = "sent";
	try {
		const result = await wahaSendText(
			account.sessionName,
			String(reply.chatId),
			reply.text,
		);
		externalId = result.id;
		const snapshot = await wahaGetChatPresence(
			account.sessionName,
			String(reply.chatId),
		).catch(() => null);
		const presence = snapshot?.presences[0];
		if (presence) {
			await upsertBotUserPresence({
				messenger: "whatsapp-personal",
				userId: String(reply.chatId),
				status: presence.lastKnownPresence,
				lastSeenAt:
					presence.lastSeen == null ? null : new Date(presence.lastSeen * 1000),
			}).catch((err) =>
				console.error(
					`[bitrix-webhook] не удалось сохранить WhatsApp presence: ${(err as Error).message}`,
				),
			);
		}
		console.log(
			`[bitrix-webhook] ответ оператора отправлен с личного номера ${account.phone} chat=${reply.chatId}`,
		);
	} catch (err) {
		status = "failed";
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
		console.error(
			`[bitrix-webhook] не удалось отправить ответ оператора в WhatsApp: ${(err as Error).message}`,
		);
	}
	await logOperatorReply("whatsapp-personal", reply, externalId, status);
	return true;
}

/** Ответ оператора считается отправленным без ошибки только если сам
 * вызов sendMessengerMessage не бросил исключение — иначе тред в едином
 * инбоксе показывал бы галочку «отправлено» даже на упавшей отправке. */
async function relayOperatorReply(reply: OperatorReplyMessage): Promise<void> {
	const isRegisteredEcho = await consumeOperatorMirrorEcho(operatorReplyRedis, {
		connectorId: reply.connector,
		lineId: reply.lineId,
		userId: reply.chatId,
		operatorId: reply.operatorUserId,
		text: reply.text,
	});
	if (isRegisteredEcho) {
		console.log(
			`[bitrix-webhook] собственное эхо единого инбокса пропущено message=${reply.bitrixMessageId}`,
		);
		return;
	}

	// Защитный fallback для порталов, которые сверх официального контракта
	// возвращают исходный message.id коннектора.
	if (isMirroredOperatorReply(reply)) {
		console.log(
			`[bitrix-webhook] собственное эхо единого инбокса пропущено message=${reply.externalMessageId}`,
		);
		return;
	}
	if (!(await claimOperatorReply(operatorReplyRedis, reply))) {
		console.log(
			`[bitrix-webhook] повторное событие ответа оператора пропущено message=${reply.bitrixMessageId ?? reply.externalMessageId}`,
		);
		return;
	}

	if (await relayToTelegramPersonal(reply)) return;
	if (await relayToMaxPersonal(reply)) return;
	if (await relayToWhatsAppPersonal(reply)) return;

	const messenger = messengerByConnector(reply.connector);
	if (!messenger) {
		console.warn(
			`[bitrix-webhook] неизвестный коннектор для ответа оператора: ${reply.connector}`,
		);
		return;
	}

	let status: MessageDeliveryStatus = "sent";
	let externalId: string | undefined;
	try {
		externalId = await sendMessengerMessage(
			messenger,
			String(reply.chatId),
			reply.text,
		);
		console.log(
			`[bitrix-webhook] ответ оператора переслан в ${messenger} chat=${reply.chatId}`,
		);
	} catch (err) {
		status = "failed";
		console.error(
			`[bitrix-webhook] не удалось переслать ответ оператора в ${messenger}: ${(err as Error).message}`,
		);
	}

	await logOperatorReply(messenger, reply, externalId, status);
}

/**
 * Канал отключили от линии (или линию удалили) прямо в Bitrix, в обход
 * кнопки «Отключить» в дашборде — запись в bot_connectors подчищаем сами,
 * иначе бот продолжит слать сообщения в уже неактивную линию.
 * Для личного WhatsApp это также основной обработчик нативной кнопки
 * «Отключить» в настройках канала Bitrix24: сам Bitrix деактивирует слот,
 * а мы по OnImConnectorStatusDelete удаляем WAHA-сессию и запись аккаунта.
 */
async function handleConnectorDisabled(
	info: ConnectorDisabledInfo,
): Promise<void> {
	if (
		info.connector?.startsWith(env.WA_PERSONAL_CONNECTOR_ID) &&
		info.lineId != null
	) {
		const lineId = String(info.lineId);
		const account = await getWhatsappPersonalAccountByConnector(
			info.connector,
			lineId,
		);
		if (!account) return;

		try {
			await wahaDeleteSession(account.sessionName);
		} catch (err) {
			// Даже если WAHA временно недоступна, удаляем привязку из БД:
			// отключённый в Bitrix номер больше не должен принимать/слать сообщения.
			console.error(
				`[bitrix-webhook] не удалось удалить WAHA-сессию ${account.sessionName}: ${(err as Error).message}`,
			);
		}

		await removeWhatsappPersonalAccount(
			account.memberId,
			lineId,
			info.connector,
		);
		console.log(
			`[bitrix-webhook] личный WhatsApp ${info.connector} отключён на линии ${lineId}`,
		);
		return;
	}

	const messenger = messengerByConnector(info.connector);
	if (!messenger) return;
	try {
		await removeBotConnector(messenger);
		console.log(
			`[bitrix-webhook] канал ${messenger} отключён на стороне Bitrix — запись в bot_connectors удалена`,
		);
	} catch (err) {
		console.error(
			`[bitrix-webhook] не удалось удалить bot_connectors для ${messenger}: ${(err as Error).message}`,
		);
	}
}

const bitrixHandler = bitrixWebhookHandler({
	token: env.BITRIX_WEBHOOK_TOKEN,
	onOperatorReply: relayOperatorReply,
	onConnectorDisabled: handleConnectorDisabled,
});

/**
 * Приём входящих сообщений личных номеров WhatsApp от WAHA (событие
 * `message`, настраивается per-session при создании — см.
 * packages/api/src/routers/whatsapp-personal). Аналог relayInboundMessage
 * в apps/tg-userbot-worker, но без always-on процесса: постоянное
 * соединение держит контейнер WAHA, а сюда прилетает обычный HTTP POST.
 */

interface WahaMessageEvent {
	event?: string;
	session?: string;
	payload?: {
		id?: string;
		timestamp?: number;
		from?: string;
		fromMe?: boolean;
		body?: string;
		/** В групповых чатах — jid автора сообщения. */
		participant?: string;
		_data?: { notifyName?: string; pushName?: string };
		/** Только для event === "message.ack". */
		ack?: number;
		ackName?: string;
		/** Только для event === "presence.update". */
		presences?: Array<{
			participant?: string;
			lastKnownPresence?: string;
			lastSeen?: number | null;
		}>;
		/** Голосовые/аудио и другие вложения — WAHA скачивает медиа сама и
		 * отдаёт ссылку в вебхуке (опция downloadMedia в конфиге сессии).
		 * Форма пейлоада не задокументирована жёстко — код ниже читает поля
		 * защитно и просто не считает сообщение голосовым, если их нет. */
		hasMedia?: boolean;
		media?: {
			url?: string;
			mimetype?: string;
			filename?: string;
		};
		/** Только для event === "session.status". */
		status?: string;
		data?: {
			reachoutTimelock?: {
				enforcementType?: string;
				isActive?: boolean;
				timeEnforcementEnds?: number;
			};
		};
	};
}

/** WAHA подписывает тело запроса HMAC-ключом сессии (sha512) — сверяем,
 * чтобы роут нельзя было накормить поддельными сообщениями. */
function verifyHmac(rawBody: string, header: string | null): boolean {
	const key = env.WAHA_WEBHOOK_SECRET;
	if (!key) return true; // секрет не настроен — работаем без проверки
	if (!header) return false;
	const expected = createHmac("sha512", key).update(rawBody).digest("hex");
	const a = Buffer.from(expected, "utf8");
	const b = Buffer.from(header, "utf8");
	return a.length === b.length && timingSafeEqual(a, b);
}

async function handleWahaWebhook(request: Request): Promise<Response> {
	const rawBody = await request.text();
	if (!verifyHmac(rawBody, request.headers.get("x-webhook-hmac"))) {
		console.warn("[waha-webhook] неверная HMAC-подпись — запрос отброшен");
		return new Response("Unauthorized", { status: 401 });
	}

	let event: WahaMessageEvent;
	try {
		event = JSON.parse(rawBody) as WahaMessageEvent;
	} catch {
		return new Response("Invalid JSON", { status: 400 });
	}

	if (event.event === "session.status") {
		const session = event.session;
		if (!session) return Response.json({ ok: true });
		const status = event.payload?.status;
		const lock = event.payload?.data?.reachoutTimelock;
		const lockActive =
			Boolean(lock?.isActive) &&
			(lock?.timeEnforcementEnds ?? 0) > Math.floor(Date.now() / 1000);

		if (status === "WORKING" && !lockActive) {
			await setWhatsappPersonalAccountStateBySession(
				session,
				"connected",
				null,
			).catch((err) =>
				console.error(
					`[waha-webhook] не удалось сохранить WORKING для ${session}: ${(err as Error).message}`,
				),
			);
		} else if (status === "WORKING" && lockActive) {
			const until = new Date(
				(lock?.timeEnforcementEnds ?? 0) * 1000,
			).toISOString();
			await setWhatsappPersonalAccountStateBySession(
				session,
				"limited",
				`WhatsApp временно ограничил исходящие сообщения до ${until}`,
			).catch((err) =>
				console.error(
					`[waha-webhook] не удалось сохранить ограничение ${session}: ${(err as Error).message}`,
				),
			);
		} else if (status === "FAILED" || status === "STOPPED") {
			await setWhatsappPersonalAccountStateBySession(
				session,
				"error",
				`WhatsApp-сессия отключена (WAHA: ${status}) — переподключите номер`,
			).catch((err) =>
				console.error(
					`[waha-webhook] не удалось сохранить ошибку ${session}: ${(err as Error).message}`,
				),
			);
		}
		return Response.json({ ok: true });
	}

	if (event.event === "message.ack") {
		const id = event.payload?.id;
		const status = id ? wahaAckToStatus(event.payload ?? {}) : null;
		if (id && status) {
			await updateBotMessageStatus(id, status).catch((err) =>
				console.error(
					`[waha-webhook] не удалось обновить статус сообщения ${id}: ${(err as Error).message}`,
				),
			);
			await forwardWhatsappAckToMessageSender(id, status).catch((err) =>
				console.error(
					`[waha-webhook] не удалось передать статус ${id} в провайдер CRM: ${(err as Error).message}`,
				),
			);
		}
		return Response.json({ ok: true });
	}

	if (event.event === "presence.update") {
		const chatId = event.payload?.id;
		const presence =
			event.payload?.presences?.find((item) => item.participant === chatId) ??
			event.payload?.presences?.[0];
		if (chatId?.endsWith("@c.us") && presence?.lastKnownPresence) {
			await upsertBotUserPresence({
				messenger: "whatsapp-personal",
				userId: chatId,
				status: presence.lastKnownPresence,
				lastSeenAt:
					presence.lastSeen == null ? null : new Date(presence.lastSeen * 1000),
			}).catch((err) =>
				console.error(
					`[waha-webhook] не удалось сохранить presence ${chatId}: ${(err as Error).message}`,
				),
			);
		}
		return Response.json({ ok: true });
	}

	if (event.event !== "message") return Response.json({ ok: true });

	const { session, payload } = event;
	const chatId = payload?.from;
	const text = payload?.body?.trim();
	const hasMedia = Boolean(payload?.hasMedia) && Boolean(payload?.media?.url);
	const isAudio =
		hasMedia && (payload?.media?.mimetype?.startsWith("audio/") ?? false);
	const isImage =
		hasMedia && (payload?.media?.mimetype?.startsWith("image/") ?? false);
	// fromMe: и собственные сообщения оператора (мы сами их отправили через
	// sendText — Bitrix уже показал их в чате), и сообщения владельца номера
	// с телефона — их дублировать в линию нечем идентифицировать, пропускаем.
	if (!session || !chatId || (!text && !hasMedia) || payload?.fromMe) {
		return Response.json({ ok: true });
	}
	// Группы и статусы в Открытую линию не тащим: чат линии — диалог 1:1.
	if (!chatId.endsWith("@c.us")) return Response.json({ ok: true });

	const mediaFileName = payload?.media?.filename ?? "file";
	const effectiveText =
		text ||
		(isAudio ? "Голосовое сообщение" : hasMedia ? `[${mediaFileName}]` : "");

	const account = await getWhatsappPersonalAccountBySession(session);
	if (!account) {
		console.warn(`[waha-webhook] нет аккаунта для WAHA-сессии ${session}`);
		return Response.json({ ok: true });
	}

	// Телефон из jid передаём отдельно от user.id — по нему CRM-трекер Bitrix
	// привязывает существующий контакт/лид вместо создания «неопознанного»
	// (см. relayInboundMessage в apps/tg-userbot-worker — та же логика).
	const senderPhone = phoneFromJid(chatId);
	const senderName =
		payload?._data?.notifyName ??
		payload?._data?.pushName ??
		`WhatsApp ${senderPhone ?? chatId}`;

	// Голосовое/фото/файл — перезаливаем в наше S3, чтобы инбокс «Клиенты»
	// показывал плеер/превью/ссылку на скачивание, а не просто заглушку.
	let mediaS3Key: string | undefined;
	const mediaKind: "voice" | "image" | "file" = isAudio
		? "voice"
		: isImage
			? "image"
			: "file";
	if (hasMedia && payload?.media?.url) {
		try {
			const res = await fetch(
				payload.media.url,
				env.WAHA_API_KEY
					? { headers: { "X-Api-Key": env.WAHA_API_KEY } }
					: undefined,
			);
			if (res.ok) {
				const bytes = new Uint8Array(await res.arrayBuffer());
				const contentType =
					payload.media.mimetype ||
					res.headers.get("content-type") ||
					(isAudio ? "audio/ogg" : "application/octet-stream");
				const uploaded = await uploadWahaMedia({
					bytes,
					contentType,
					messageId: payload?.id ?? `wa-personal-${Date.now()}`,
					fileName: mediaKind === "file" ? mediaFileName : undefined,
				});
				mediaS3Key = uploaded.mediaS3Key;
			}
		} catch (err) {
			console.error(
				`[waha-webhook] не удалось перезалить вложение: ${(err as Error).message}`,
			);
		}
	}

	// Журналируем в bot_messages/bot_users до обращения к Bitrix — если у
	// портала недоступен OAuth-токен, единый инбокс дашборда (apps/clients)
	// всё равно должен увидеть сообщение от клиента, а не потерять его вместе
	// с пересылкой в Открытую линию.
	try {
		await upsertBotUser({
			messenger: "whatsapp-personal",
			userId: chatId,
			name: senderName,
		});
		await insertBotMessage({
			messenger: "whatsapp-personal",
			userId: chatId,
			direction: "in",
			source: "scenario",
			text: effectiveText,
			connectorId: account.connectorId,
			...(mediaS3Key
				? {
						kind: mediaKind,
						mediaS3Key,
						mediaMimeType: payload?.media?.mimetype,
						mediaFileName: mediaKind === "file" ? mediaFileName : undefined,
					}
				: {}),
		});
	} catch (err) {
		console.error(
			`[waha-webhook] не удалось записать входящее сообщение в журнал: ${(err as Error).message}`,
		);
	}

	const api = resolveBitrixApi(account.memberId);
	if (!api) {
		console.error(
			`[waha-webhook] нет OAuth-клиента Bitrix для портала ${account.memberId}`,
		);
		return Response.json({ ok: true });
	}

	try {
		await api.call("imconnector.send.messages", {
			CONNECTOR: account.connectorId,
			LINE: Number(account.openLineId),
			MESSAGES: [
				{
					user: {
						id: chatId,
						name: senderName,
						...(senderPhone ? { phone: senderPhone } : {}),
						skip_phone_validate: "Y",
					},
					message: {
						id: payload?.id ?? `wa-personal-${Date.now()}`,
						date: payload?.timestamp ?? Math.floor(Date.now() / 1000),
						text: effectiveText,
						...(hasMedia && payload?.media?.url
							? {
									files: [
										{
											url: payload.media.url,
											name: payload.media.filename ?? mediaKind,
										},
									],
								}
							: {}),
					},
					chat: { id: chatId, name: senderName },
				},
			],
		});
	} catch (err) {
		console.error(
			`[waha-webhook] не удалось переслать сообщение в Открытую линию (${account.memberId}:${account.openLineId}): ${(err as Error).message}`,
		);
	}

	return Response.json({ ok: true });
}

/**
 * Проверка `auth[application_token]` в вебхуке Bitrix24 (application/x-www-form-urlencoded)
 * против общего пула токенов приложения. Возвращает распарсенную форму или null,
 * если тело некорректно/токен не совпал — используется всеми CRM-вебхук-обработчиками.
 */
async function verifyCrmWebhookForm(
	request: Request,
): Promise<FormData | null> {
	const webhookTokens = [
		env.BITRIX_CRM_WEBHOOK_TOKEN,
		...(env.BITRIX_WEBHOOK_TOKEN ?? "").split(","),
	]
		.map((token) => token?.trim())
		.filter((token): token is string => Boolean(token));
	if (webhookTokens.length === 0) return null;

	const form = await request.formData().catch(() => null);
	if (!form) return null;
	if (
		!webhookTokens.includes(String(form.get("auth[application_token]") ?? ""))
	) {
		return null;
	}
	return form;
}

/**
 * Обработчик события ONCRMDEALUPDATE (привязывается через event.bind).
 * Bitrix шлёт его как application/x-www-form-urlencoded, а не JSON.
 */
async function handleConsultationReminderDealUpdate(
	request: Request,
): Promise<Response> {
	try {
		const form = await verifyCrmWebhookForm(request);
		if (!form) return new Response("Unauthorized", { status: 401 });

		const dealId = Number(form.get("data[FIELDS][ID]") ?? 0);
		if (!dealId) {
			return Response.json({ success: false, message: "No deal id" });
		}

		const api = resolveBitrixApi(env.BITRIX_MEMBER_ID);
		if (!api) {
			return Response.json(
				{ success: false, message: "Bitrix24 не подключён" },
				{ status: 500 },
			);
		}

		const redis = createRedisClient();
		const [consultation, diagnostic, stageConsent] = await Promise.all([
			handleConsultationDealUpdate(api, redis, dealId),
			handleDiagnosticDealUpdate(api, redis, dealId),
			handleStageConsentTrigger(api, redis, dealId),
		]);
		const result = { consultation, diagnostic, stageConsent };
		return Response.json({ success: true, result });
	} catch (err) {
		const message =
			err instanceof Error ? (err.stack ?? err.message) : String(err);
		console.error("[consultation-reminder] deal-update error:", err);
		return Response.json(
			{
				success: false,
				message: err instanceof Error ? err.message : String(err),
				stack: message,
			},
			{ status: 500 },
		);
	}
}

/**
 * Обработчик OnCrmDealAdd/OnCrmDealUpdate для локального зеркала сделок
 * (packages/db, таблица deals — см. packages/jobs/src/deals-sync.ts). Отдельно
 * от handleConsultationReminderDealUpdate: разная ответственность, разные
 * подписки на событие (Bitrix поддерживает несколько handler-ов на одно событие).
 */
async function handleDealSyncUpsert(request: Request): Promise<Response> {
	try {
		const form = await verifyCrmWebhookForm(request);
		if (!form) return new Response("Unauthorized", { status: 401 });

		const dealId = String(form.get("data[FIELDS][ID]") ?? "");
		if (!dealId) {
			return Response.json({ success: false, message: "No deal id" });
		}

		const api = resolveBitrixApi(env.BITRIX_MEMBER_ID);
		if (!api) {
			return Response.json(
				{ success: false, message: "Bitrix24 не подключён" },
				{ status: 500 },
			);
		}

		const result = await syncOneDeal(api, dealId);
		return Response.json({ success: true, result });
	} catch (err) {
		console.error("[deal-sync] upsert error:", err);
		return Response.json(
			{
				success: false,
				message: err instanceof Error ? err.message : String(err),
			},
			{ status: 500 },
		);
	}
}

/** Обработчик OnCrmDealDelete — убирает сделку из локального зеркала. */
async function handleDealSyncDelete(request: Request): Promise<Response> {
	try {
		const form = await verifyCrmWebhookForm(request);
		if (!form) return new Response("Unauthorized", { status: 401 });

		const dealId = String(form.get("data[FIELDS][ID]") ?? "");
		if (!dealId) {
			return Response.json({ success: false, message: "No deal id" });
		}

		await removeSyncedDeal(dealId);
		return Response.json({ success: true });
	} catch (err) {
		console.error("[deal-sync] delete error:", err);
		return Response.json(
			{
				success: false,
				message: err instanceof Error ? err.message : String(err),
			},
			{ status: 500 },
		);
	}
}

/**
 * HANDLER провайдеров сообщений CRM (messageservice.sender.add, см.
 * message-sender.ts) — «Написать клиенту»/роботы «Отправить SMS» с личного
 * номера WhatsApp/Telegram. Отправку дожидаемся в рамках запроса (не в фоне),
 * чтобы обработчик оставался serverless-совместимым; итоговый статус
 * Bitrix получает отдельным вызовом messageservice.message.status.update.
 */
async function handleMessageSender(request: Request): Promise<Response> {
	const form = await verifyCrmWebhookForm(request);
	if (!form) return new Response("Unauthorized", { status: 401 });

	const payload = parseMessageSenderForm(form);
	if (!payload) {
		console.warn(
			`[message-sender] некорректный запрос провайдера: code=${String(form.get("code"))} message_id=${String(form.get("message_id"))}`,
		);
		return Response.json({ success: false }, { status: 400 });
	}

	try {
		await handleMessageSenderPayload(payload);
	} catch (err) {
		console.error(
			`[message-sender] ошибка обработки ${payload.messageId}: ${(err as Error).message}`,
		);
	}
	return Response.json({ success: true });
}

const CRM_DEAL_UPDATE_HANDLER_URL =
	process.env.BITRIX_CRM_DEAL_UPDATE_HANDLER_URL?.trim() ||
	"https://psi-opora-bitrix-webhook.orixon.ru/api/consultation-reminder-deal-update";
const DEAL_SYNC_UPSERT_HANDLER_URL =
	process.env.BITRIX_DEAL_SYNC_UPSERT_HANDLER_URL?.trim() ||
	"https://psi-opora-bitrix-webhook.orixon.ru/api/deal-sync-upsert";
const DEAL_SYNC_DELETE_HANDLER_URL =
	process.env.BITRIX_DEAL_SYNC_DELETE_HANDLER_URL?.trim() ||
	"https://psi-opora-bitrix-webhook.orixon.ru/api/deal-sync-delete";

/** Идемпотентная регистрация обработчика события через event.bind (см. ensureCrmDealUpdateSubscription — исходный прецедент для OnCrmDealUpdate). */
async function ensureCrmEventSubscription(
	event: string,
	handlerUrl: string,
): Promise<void> {
	try {
		const api = resolveBitrixApi(env.BITRIX_MEMBER_ID);
		if (!api) throw new Error("Bitrix24 не подключён");

		const handlers =
			await api.call<Array<{ event?: string; handler?: string }>>("event.get");
		const alreadyBound = handlers.some(
			(item) =>
				String(item.event ?? "").toUpperCase() === event.toUpperCase() &&
				String(item.handler ?? "").replace(/\/$/, "") ===
					handlerUrl.replace(/\/$/, ""),
		);
		if (alreadyBound) return;

		await api.call("event.bind", { event, handler: handlerUrl });
		console.log(`[deal-sync] подписка ${event} создана: ${handlerUrl}`);
	} catch (error) {
		console.error(
			`[deal-sync] не удалось проверить/создать подписку ${event} → ${handlerUrl}: ${(error as Error).message}`,
		);
	}
}

const app = new Hono();

app.get("/", (c) =>
	c.text("Bitrix24 Webhook\nWebhook endpoint: POST /api/bitrix-webhook"),
);

app.get("/api/bitrix-webhook", (c) => c.json({ status: "ok" }));
app.post("/api/bitrix-webhook", (c) => bitrixHandler(c.req.raw));

app.get("/api/waha-webhook", (c) => c.json({ status: "ok" }));
app.post("/api/waha-webhook", (c) => handleWahaWebhook(c.req.raw));
app.post("/api/payform-webhook", (c) => handlePayformWebhook(c.req.raw));

app.get("/api/message-sender", (c) => c.json({ status: "ok" }));
app.post("/api/message-sender", (c) => handleMessageSender(c.req.raw));

app.get("/api/consultation-reminder-deal-update", (c) =>
	c.json({ status: "ok" }),
);
app.post("/api/consultation-reminder-deal-update", (c) =>
	handleConsultationReminderDealUpdate(c.req.raw),
);

app.get("/api/deal-sync-upsert", (c) => c.json({ status: "ok" }));
app.post("/api/deal-sync-upsert", (c) => handleDealSyncUpsert(c.req.raw));

app.get("/api/deal-sync-delete", (c) => c.json({ status: "ok" }));
app.post("/api/deal-sync-delete", (c) => handleDealSyncDelete(c.req.raw));

const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, port }, (info) => {
	console.log(`[bitrix-webhook] слушает на :${info.port}`);
	void ensureCrmEventSubscription(
		"OnCrmDealUpdate",
		CRM_DEAL_UPDATE_HANDLER_URL,
	);
	void ensureCrmEventSubscription("OnCrmDealAdd", DEAL_SYNC_UPSERT_HANDLER_URL);
	void ensureCrmEventSubscription(
		"OnCrmDealUpdate",
		DEAL_SYNC_UPSERT_HANDLER_URL,
	);
	void ensureCrmEventSubscription(
		"OnCrmDealDelete",
		DEAL_SYNC_DELETE_HANDLER_URL,
	);
});

// При rollout k8s шлёт SIGTERM до SIGKILL — дожидаемся завершения активных
// запросов вместо мгновенного обрыва соединений.
process.on("SIGTERM", () => {
	server.close(() => process.exit(0));
});
