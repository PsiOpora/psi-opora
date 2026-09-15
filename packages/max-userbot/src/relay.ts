import { env } from "@psi-opora/config";
import { type MaxUserbotSession, sessionInit } from "./login";
import { MaxProtocolClient } from "./protocol/client";
import { OPCODE } from "./protocol/opcodes";

/**
 * Держит постоянное соединение личного аккаунта MAX (Фаза 2, будущий
 * apps/max-userbot-worker, по образцу packages/tg-userbot/src/relay.ts) — в
 * отличие от login.ts (одноразовые короткие подключения на каждый шаг
 * логина), реконнектится на сохранённой сессии через LOGIN (opcode 19) так
 * же, как это делают независимые рабочие клиенты Grovvik/vkmax-nodejs
 * (`loginByToken`) и nsdkinx/vkmax (`login_by_token`) — единственные
 * найденные примеры именно реконнекта по токену, а не свежего входа по SMS.
 *
 * ВНИМАНИЕ: точная раскладка полей пуш-уведомлений (NOTIF_MESSAGE и т.д.,
 * opcode 128/129/132 — см. protocol/opcodes.ts) нигде не задокументирована.
 * И PronikFire/Max-API-Guide (таблица opcode без деталей payload), и оба
 * рабочих клиента выше прокидывают такие пуши как есть, без парсинга.
 * Поля ниже (chatId/messageId/senderId/text) подобраны по аналогии со
 * связанными структурами (MSG_SEND-запрос, CHAT_HISTORY-ответ) и почти
 * наверняка потребуют правки по итогам живой проверки —
 * см. scripts/manual-relay.ts.
 */

export interface MaxIncomingMessage {
	chatId: string;
	messageId: string | null;
	senderId: string | null;
	text: string;
	/** Исходный пейлоад пуша — на случай, если разбор выше промахнулся мимо
	 * реальных имён полей (см. предупреждение вверху файла). */
	raw: Record<string, unknown>;
}

export interface MaxTypingEvent {
	chatId: string | null;
	userId: string | null;
	raw: Record<string, unknown>;
}

export interface MaxPresenceEvent {
	userId: string | null;
	raw: Record<string, unknown>;
}

export interface MaxUserbotHandlers {
	onMessage?: (message: MaxIncomingMessage) => void | Promise<void>;
	onTyping?: (event: MaxTypingEvent) => void | Promise<void>;
	onPresence?: (event: MaxPresenceEvent) => void | Promise<void>;
	onDisconnect?: (error: Error) => void;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: undefined;
}

function asId(value: unknown): string | null {
	if (typeof value === "string" && /^\d+$/.test(value)) return value;
	if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
		return String(value);
	}
	return null;
}

function toProtocolId(value: string, label: string): number | bigint {
	if (!/^\d+$/.test(value)) throw new Error(`Некорректный ${label} MAX`);
	const bigint = BigInt(value);
	return bigint <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(bigint) : bigint;
}

function parseIncomingMessage(
	payload: Record<string, unknown>,
): MaxIncomingMessage {
	const message = asRecord(payload.message) ?? payload;
	return {
		chatId: asId(payload.chatId ?? message.chatId) ?? "",
		messageId:
			typeof message.id === "string"
				? message.id
				: typeof message.id === "number"
					? String(message.id)
					: null,
		senderId: asId(message.sender ?? message.senderId ?? payload.senderId),
		text: typeof message.text === "string" ? message.text : "",
		raw: payload,
	};
}

function dispatchPush(
	opcode: number,
	payload: Record<string, unknown>,
	handlers: MaxUserbotHandlers,
): void {
	switch (opcode) {
		case OPCODE.NOTIF_MESSAGE: {
			void handlers.onMessage?.(parseIncomingMessage(payload));
			return;
		}
		case OPCODE.NOTIF_TYPING: {
			void handlers.onTyping?.({
				chatId: asId(payload.chatId),
				userId: asId(payload.userId ?? payload.senderId),
				raw: payload,
			});
			return;
		}
		case OPCODE.NOTIF_PRESENCE: {
			void handlers.onPresence?.({
				userId: asId(payload.userId ?? payload.contactId),
				raw: payload,
			});
			return;
		}
		default:
			return;
	}
}

/**
 * Открывает постоянное соединение и реконнектится на сохранённой сессии.
 * `sessionJson` — то, что было сохранено в БД (расшифрованный `session` из
 * MaxUserbotSession, см. login.ts).
 */
export async function createUserbotClient(
	sessionJson: string,
	handlers: MaxUserbotHandlers = {},
): Promise<MaxProtocolClient> {
	const session: MaxUserbotSession = JSON.parse(sessionJson);

	const client = new MaxProtocolClient({
		onPush: (opcode, payload) => dispatchPush(opcode, payload, handlers),
		onClose: handlers.onDisconnect,
	});
	try {
		await client.connect();
		await sessionInit(client, session.deviceId);

		// Поля синхронизации по нулям/-1 — так делают оба рабочих клиента
		// (Grovvik/vkmax-nodejs, nsdkinx/vkmax) при входе по сохранённому токену;
		// здесь это не полная синхронизация истории (см. CHAT_HISTORY отдельно),
		// а обязательный набор полей запроса LOGIN.
		const loginResponse = await client.request(OPCODE.LOGIN, {
			token: session.sessionToken,
			interactive: true,
			chatsSync: 0,
			contactsSync: 0,
			presenceSync: -1,
			draftsSync: 0,
			chatsCount: 40,
		});
		if (typeof loginResponse.error === "string") {
			throw new Error(
				`MAX отклонил вход по сохранённой сессии: ${loginResponse.error}`,
			);
		}
	} catch (error) {
		client.close();
		throw error;
	}

	return client;
}

export async function sendUserbotMessage(
	client: MaxProtocolClient,
	chatId: string,
	text: string,
): Promise<string> {
	const response = await client.request(OPCODE.MSG_SEND, {
		chatId: toProtocolId(chatId, "chatId"),
		message: {
			text,
			cid: Date.now(),
			elements: [],
			attaches: [],
		},
		notify: true,
	});
	const message = asRecord(response.message);
	const id = message?.id;
	if (typeof id === "string") return id;
	if (typeof id === "number") return String(id);
	throw new Error(
		`MAX не вернул id отправленного сообщения: ${JSON.stringify(response)}`,
	);
}

/** Отзывает сообщение личного аккаунта. `deleteForMe: false` — отзыв для
 * обеих сторон диалога (аналог revoke у Telegram), см. MSG_DELETE. */
export async function deleteUserbotMessage(
	client: MaxProtocolClient,
	chatId: string,
	externalId: string,
	deleteForMe = false,
): Promise<void> {
	await client.request(OPCODE.MSG_DELETE, {
		chatId: toProtocolId(chatId, "chatId"),
		messageIds: [externalId],
		forMe: deleteForMe,
	});
}

// ============================================================================
// Расширенные функции отправки сообщений с вложениями (как у Komet)
// ============================================================================

export interface FileUploadInfo {
	url: string;
	fileId: number;
	token: string;
}

export interface VideoUploadInfo {
	url: string;
	videoId: number;
	token: string;
}

export interface AudioUploadInfo {
	url: string;
	audioId: number;
	token: string;
}

/**
 * Запрашивает URL для загрузки файла (opcode FILE_UPLOAD).
 * После загрузки файла на полученный URL используй `sendFileMessage` с `fileId` и `token`.
 */
export async function requestFileUploadUrl(
	client: MaxProtocolClient,
	count = 1,
): Promise<FileUploadInfo | null> {
	const response = await client.request(OPCODE.FILE_UPLOAD, { count });
	const data = asRecord(response);
	if (!data) return null;

	const infoList = data.info;
	if (!Array.isArray(infoList) || infoList.length === 0) return null;

	const info = asRecord(infoList[0]);
	if (!info) return null;

	return {
		url: typeof info.url === "string" ? info.url : "",
		fileId: typeof info.fileId === "number" ? info.fileId : 0,
		token: typeof info.token === "string" ? info.token : "",
	};
}

/**
 * Запрашивает URL для загрузки фото (opcode PHOTO_UPLOAD).
 * После загрузки используй `sendPhotoMessage` с полученным `photoToken`.
 */
export async function requestPhotoUploadUrl(
	client: MaxProtocolClient,
): Promise<string | null> {
	const response = await client.request(OPCODE.PHOTO_UPLOAD, { count: 1 });
	const data = asRecord(response);
	return typeof data?.url === "string" ? data.url : null;
}

/**
 * Запрашивает URL для загрузки видео (opcode VIDEO_UPLOAD).
 * После загрузки используй `sendVideoMessage` с `token`.
 */
export async function requestVideoUploadUrl(
	client: MaxProtocolClient,
): Promise<VideoUploadInfo | null> {
	const response = await client.request(OPCODE.VIDEO_UPLOAD, {
		uploaderType: 0,
		type: 0,
		count: 1,
	});
	const data = asRecord(response);
	if (!data) return null;

	const infoList = data.info;
	if (!Array.isArray(infoList) || infoList.length === 0) return null;

	const info = asRecord(infoList[0]);
	if (!info) return null;

	return {
		url: typeof info.url === "string" ? info.url : "",
		videoId: typeof info.videoId === "number" ? info.videoId : 0,
		token: typeof info.token === "string" ? info.token : "",
	};
}

/**
 * Запрашивает URL для загрузки аудиосообщения (голосовое сообщение через VIDEO_UPLOAD с uploaderType=1, type=2).
 */
export async function requestAudioUploadUrl(
	client: MaxProtocolClient,
): Promise<AudioUploadInfo | null> {
	const response = await client.request(OPCODE.VIDEO_UPLOAD, {
		uploaderType: 1,
		type: 2,
		count: 1,
	});
	const data = asRecord(response);
	if (!data) return null;

	const infoList = data.info;
	if (!Array.isArray(infoList) || infoList.length === 0) return null;

	const info = asRecord(infoList[0]);
	if (!info) return null;

	return {
		url: typeof info.url === "string" ? info.url : "",
		audioId: typeof info.videoId === "number" ? info.videoId : 0,
		token: typeof info.token === "string" ? info.token : "",
	};
}

/**
 * Запрашивает URL для загрузки видеосообщения (кружочек, через VIDEO_UPLOAD с uploaderType=1, type=1).
 */
export async function requestVideoNoteUploadUrl(
	client: MaxProtocolClient,
): Promise<VideoUploadInfo | null> {
	const response = await client.request(OPCODE.VIDEO_UPLOAD, {
		uploaderType: 1,
		type: 1,
		count: 1,
	});
	const data = asRecord(response);
	if (!data) return null;

	const infoList = data.info;
	if (!Array.isArray(infoList) || infoList.length === 0) return null;

	const info = asRecord(infoList[0]);
	if (!info) return null;

	return {
		url: typeof info.url === "string" ? info.url : "",
		videoId: typeof info.videoId === "number" ? info.videoId : 0,
		token: typeof info.token === "string" ? info.token : "",
	};
}

interface SendMessageOptions {
	notify?: boolean;
	scheduledTime?: number;
	replyToMessageId?: string;
	elements?: Array<Record<string, unknown>>;
}

/**
 * Вспомогательная функция для retry-логики при отправке медиа.
 * MAX может отвечать ошибкой "not.ready" если медиа ещё обрабатывается на сервере.
 */
async function sendWithNotReadyRetry<T>(
	client: MaxProtocolClient,
	payload: Record<string, unknown>,
	maxAttempts = 20,
	retryDelay = 1000,
	onResult: (response: Record<string, unknown>) => T,
	onExhausted: T,
): Promise<T> {
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			const response = await client.request(OPCODE.MSG_SEND, payload);
			return onResult(response);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			if (!errorMessage.toLowerCase().includes("not.ready")) {
				throw error;
			}
			if (attempt === maxAttempts - 1) return onExhausted;
			await new Promise((resolve) => setTimeout(resolve, retryDelay));
		}
	}
	return onExhausted;
}

function extractMessageId(response: Record<string, unknown>): string | null {
	const message = asRecord(response.message);
	const id = message?.id;
	if (typeof id === "string") return id;
	if (typeof id === "number") return String(id);
	return null;
}

/**
 * Отправляет фото по токену, полученному от `requestPhotoUploadUrl`.
 */
export async function sendPhotoMessage(
	client: MaxProtocolClient,
	chatId: string,
	photoTokens: string[],
	options: SendMessageOptions & { caption?: string } = {},
): Promise<string | null> {
	const message: Record<string, unknown> = {
		cid: Date.now() * -1,
		attaches: photoTokens.map((token) => ({
			_type: "PHOTO",
			photoToken: token,
		})),
	};
	if (options.caption) message.text = options.caption;
	if (options.elements) message.elements = options.elements;
	if (options.scheduledTime) {
		message.delayedAttributes = {
			timeToFire: options.scheduledTime,
			notifySender: true,
		};
	}
	if (options.replyToMessageId) {
		message.link = {
			type: "REPLY",
			chatId: toProtocolId(chatId, "chatId"),
			messageId: toProtocolId(options.replyToMessageId, "messageId"),
		};
	}

	const payload = {
		chatId: toProtocolId(chatId, "chatId"),
		message,
		notify: options.notify !== false,
	};

	return sendWithNotReadyRetry(
		client,
		payload,
		20,
		1000,
		extractMessageId,
		null,
	);
}

/**
 * Отправляет видео по токену, полученному от `requestVideoUploadUrl`.
 */
export async function sendVideoMessage(
	client: MaxProtocolClient,
	chatId: string,
	token: string,
	options: SendMessageOptions & { caption?: string } = {},
): Promise<string | null> {
	const message: Record<string, unknown> = {
		isLive: false,
		detectShare: false,
		elements: options.elements ?? [],
		cid: Date.now() * -1,
		attaches: [
			{
				videoType: 0,
				_type: "VIDEO",
				token,
			},
		],
	};
	if (options.caption) message.text = options.caption;
	if (options.scheduledTime) {
		message.delayedAttributes = {
			timeToFire: options.scheduledTime,
			notifySender: true,
		};
	}
	if (options.replyToMessageId) {
		message.link = {
			type: "REPLY",
			chatId: toProtocolId(chatId, "chatId"),
			messageId: toProtocolId(options.replyToMessageId, "messageId"),
		};
	}

	const payload = {
		chatId: toProtocolId(chatId, "chatId"),
		message,
		notify: options.notify !== false,
	};

	return sendWithNotReadyRetry(
		client,
		payload,
		30,
		1000,
		extractMessageId,
		null,
	);
}

/**
 * Отправляет файл по `fileId` и `token`, полученным от `requestFileUploadUrl`.
 */
export async function sendFileMessage(
	client: MaxProtocolClient,
	chatId: string,
	_fileId: number,
	token: string,
	options: SendMessageOptions = {},
): Promise<boolean> {
	const message: Record<string, unknown> = {
		isLive: false,
		detectShare: false,
		elements: [],
		cid: Date.now(),
		attaches: [
			{
				_type: "FILE",
				token,
			},
		],
	};
	if (options.scheduledTime) {
		message.delayedAttributes = {
			timeToFire: options.scheduledTime,
			notifySender: true,
		};
	}
	if (options.replyToMessageId) {
		message.link = {
			type: "REPLY",
			chatId: toProtocolId(chatId, "chatId"),
			messageId: toProtocolId(options.replyToMessageId, "messageId"),
		};
	}

	const payload = {
		chatId: toProtocolId(chatId, "chatId"),
		message,
		notify: options.notify !== false,
	};

	return sendWithNotReadyRetry(client, payload, 20, 1000, () => true, false);
}

/**
 * Отправляет аудиосообщение (голосовое) по токену от `requestAudioUploadUrl`.
 */
export async function sendAudioMessage(
	client: MaxProtocolClient,
	chatId: string,
	token: string,
	duration: number,
	options: SendMessageOptions & { wave?: Uint8Array } = {},
): Promise<string | null> {
	const message: Record<string, unknown> = {
		isLive: false,
		detectShare: false,
		elements: [],
		cid: Date.now() * -1,
		attaches: [
			{
				duration,
				_type: "AUDIO",
				wave: options.wave ?? new Uint8Array(80),
				token,
			},
		],
	};
	if (options.scheduledTime) {
		message.delayedAttributes = {
			timeToFire: options.scheduledTime,
			notifySender: true,
		};
	}
	if (options.replyToMessageId) {
		message.link = {
			type: "REPLY",
			chatId: toProtocolId(chatId, "chatId"),
			messageId: toProtocolId(options.replyToMessageId, "messageId"),
		};
	}

	const payload = {
		chatId: toProtocolId(chatId, "chatId"),
		message,
		notify: options.notify !== false,
	};

	return sendWithNotReadyRetry(
		client,
		payload,
		30,
		1000,
		extractMessageId,
		null,
	);
}

/**
 * Отправляет видеосообщение (кружочек) по токену от `requestVideoNoteUploadUrl`.
 */
export async function sendVideoNoteMessage(
	client: MaxProtocolClient,
	chatId: string,
	token: string,
	duration: number,
	options: SendMessageOptions & { wave?: Uint8Array; thumbhash?: string } = {},
): Promise<string | null> {
	const attaches: Record<string, unknown> = {
		duration,
		videoType: 1,
		_type: "VIDEO",
		wave: options.wave ?? new Uint8Array(80),
		token,
	};
	if (options.thumbhash) attaches.thumbhash = options.thumbhash;

	const message: Record<string, unknown> = {
		isLive: false,
		detectShare: false,
		elements: [],
		cid: Date.now() * -1,
		attaches: [attaches],
	};
	if (options.replyToMessageId) {
		message.link = {
			type: "REPLY",
			chatId: toProtocolId(chatId, "chatId"),
			messageId: toProtocolId(options.replyToMessageId, "messageId"),
		};
	}

	const payload = {
		chatId: toProtocolId(chatId, "chatId"),
		message,
		notify: options.notify !== false,
	};

	return sendWithNotReadyRetry(
		client,
		payload,
		30,
		1000,
		extractMessageId,
		null,
	);
}

/**
 * Отправляет стикер по его ID.
 */
export async function sendStickerMessage(
	client: MaxProtocolClient,
	chatId: string,
	stickerId: number,
	options: SendMessageOptions = {},
): Promise<string | null> {
	const message: Record<string, unknown> = {
		cid: Date.now() * -1,
		attaches: [
			{
				_type: "STICKER",
				stickerId,
			},
		],
	};
	if (options.replyToMessageId) {
		message.link = {
			type: "REPLY",
			chatId: toProtocolId(chatId, "chatId"),
			messageId: toProtocolId(options.replyToMessageId, "messageId"),
		};
	}

	const payload = {
		chatId: toProtocolId(chatId, "chatId"),
		message,
		notify: options.notify !== false,
	};

	const response = await client.request(OPCODE.MSG_SEND, payload);
	return extractMessageId(response);
}

/**
 * Отправляет геолокацию.
 */
export async function sendLocationMessage(
	client: MaxProtocolClient,
	chatId: string,
	latitude: number,
	longitude: number,
	options: SendMessageOptions & { zoom?: number } = {},
): Promise<string | null> {
	const message: Record<string, unknown> = {
		cid: Date.now() * -1,
		attaches: [
			{
				_type: "LOCATION",
				latitude,
				longitude,
				zoom: options.zoom ?? 15,
			},
		],
	};
	if (options.replyToMessageId) {
		message.link = {
			type: "REPLY",
			chatId: toProtocolId(chatId, "chatId"),
			messageId: toProtocolId(options.replyToMessageId, "messageId"),
		};
	}

	const payload = {
		chatId: toProtocolId(chatId, "chatId"),
		message,
		notify: options.notify !== false,
	};

	const response = await client.request(OPCODE.MSG_SEND, payload);
	return extractMessageId(response);
}

/**
 * Отправляет опрос.
 */
export async function sendPollMessage(
	client: MaxProtocolClient,
	chatId: string,
	title: string,
	answers: string[],
	options: SendMessageOptions & {
		multiple?: boolean;
		anonymous?: boolean;
	} = {},
): Promise<string | null> {
	const POLL_ANONYMOUS_FLAG = 4;
	const POLL_MULTIPLE_FLAG = 1;

	const settings =
		(options.anonymous !== false ? POLL_ANONYMOUS_FLAG : 0) |
		(options.multiple === true ? POLL_MULTIPLE_FLAG : 0);

	const message: Record<string, unknown> = {
		cid: Date.now() * -1,
		attaches: [
			{
				_type: "POLL",
				title,
				settings,
				answers: answers.map((a) => ({ text: a })),
			},
		],
	};
	if (options.replyToMessageId) {
		message.link = {
			type: "REPLY",
			chatId: toProtocolId(chatId, "chatId"),
			messageId: toProtocolId(options.replyToMessageId, "messageId"),
		};
	}

	const payload = {
		chatId: toProtocolId(chatId, "chatId"),
		message,
		notify: options.notify !== false,
	};

	const response = await client.request(OPCODE.MSG_SEND, payload);
	return extractMessageId(response);
}

export interface MaxContact {
	userId: string;
	raw: Record<string, unknown>;
}

/**
 * Резолвит контакта по номеру телефона (CONTACT_INFO_BY_PHONE) — аналог
 * resolveClientPhoneNumber у tg-userbot. Возвращает только userId контакта:
 * подтверждённого opcode для создания/открытия приватного чата по userId в
 * доступных разборах протокола НЕТ (CHAT_CREATE=63 в PronikFire/Max-API-Guide
 * помечен `~`, т.е. не подтверждён исходниками) — поэтому «написать первым»
 * для MAX (в отличие от Telegram) пока нельзя довести до конца через этот
 * пакет: нужен либо подтверждённый CHAT_CREATE, либо chatId уже существующего
 * диалога. Известное ограничение, см. README «Известные ограничения».
 */
export async function resolveClientPhoneNumber(
	client: MaxProtocolClient,
	phone: string,
): Promise<MaxContact> {
	const response = await client.request(OPCODE.CONTACT_INFO_BY_PHONE, {
		phone,
	});
	const contact = asRecord(response.contact);
	const userId = asId(contact?.id ?? contact?.userId ?? contact?.contactId);
	if (!contact || userId === null) {
		throw new Error(
			`MAX не нашёл контакт по номеру ${phone}: ${JSON.stringify(response)}`,
		);
	}
	return { userId, raw: contact };
}

// ============================================================================
// Редактирование, удаление, реакции, пересылка
// ============================================================================

/**
 * Редактирует текст сообщения.
 */
export async function editUserbotMessage(
	client: MaxProtocolClient,
	chatId: string,
	messageId: string,
	text: string,
	options: { elements?: Array<Record<string, unknown>> } = {},
): Promise<boolean> {
	const payload = {
		messageId: toProtocolId(messageId, "messageId"),
		chatId: toProtocolId(chatId, "chatId"),
		elements: options.elements ?? [],
		text,
	};

	try {
		await client.request(OPCODE.MSG_EDIT, payload);
		return true;
	} catch {
		return false;
	}
}

/**
 * Удаляет несколько сообщений. `forEveryone: true` — удаление для всех участников чата.
 */
export async function deleteUserbotMessages(
	client: MaxProtocolClient,
	chatId: string,
	messageIds: string[],
	forEveryone = false,
): Promise<boolean> {
	const ids = messageIds
		.map((id) => {
			try {
				const parsed = toProtocolId(id, "messageId");
				return typeof parsed === "number" ? parsed : Number(parsed);
			} catch {
				return null;
			}
		})
		.filter((id): id is number => id !== null);

	if (ids.length === 0) return false;

	const payload = {
		messageIds: ids,
		chatId: toProtocolId(chatId, "chatId"),
		forMe: !forEveryone,
	};

	try {
		await client.request(OPCODE.MSG_DELETE, payload);
		return true;
	} catch {
		return false;
	}
}

/**
 * Устанавливает реакцию на сообщение (эмодзи).
 */
export async function setMessageReaction(
	client: MaxProtocolClient,
	chatId: string,
	messageId: string,
	emoji: string,
): Promise<boolean> {
	const payload = {
		chatId: toProtocolId(chatId, "chatId"),
		messageId: toProtocolId(messageId, "messageId"),
		reaction: {
			reactionType: "EMOJI",
			id: emoji,
		},
	};

	try {
		await client.request(OPCODE.MSG_REACTION, payload);
		return true;
	} catch {
		return false;
	}
}

/**
 * Отменяет реакцию на сообщение.
 */
export async function cancelMessageReaction(
	client: MaxProtocolClient,
	chatId: string,
	messageId: string,
): Promise<boolean> {
	const payload = {
		chatId: toProtocolId(chatId, "chatId"),
		messageId: toProtocolId(messageId, "messageId"),
	};

	try {
		await client.request(OPCODE.MSG_CANCEL_REACTION, payload);
		return true;
	} catch {
		return false;
	}
}

/**
 * Пересылает сообщение из одного чата в другой.
 */
export async function forwardUserbotMessage(
	client: MaxProtocolClient,
	targetChatId: string,
	sourceChatId: string,
	messageId: string,
	options: { notify?: boolean } = {},
): Promise<string | null> {
	const message: Record<string, unknown> = {
		isLive: false,
		detectShare: false,
		elements: [],
		attaches: [],
		cid: Date.now() * -1,
		link: {
			type: "FORWARD",
			chatId: toProtocolId(sourceChatId, "chatId"),
			messageId: toProtocolId(messageId, "messageId"),
		},
	};

	const payload = {
		chatId: toProtocolId(targetChatId, "chatId"),
		message,
		notify: options.notify !== false,
	};

	const response = await client.request(OPCODE.MSG_SEND, payload);
	return extractMessageId(response);
}

/**
 * Отправляет индикатор набора текста в чат.
 * `type` может быть "TEXT", "AUDIO", "VIDEO" и т.д.
 */
export async function sendTypingIndicator(
	client: MaxProtocolClient,
	chatId: string,
	type = "TEXT",
): Promise<void> {
	try {
		await client.request(OPCODE.MSG_TYPING, {
			chatId: toProtocolId(chatId, "chatId"),
			type,
		});
	} catch {
		// Игнорируем ошибки typing indicator'а — не критично
	}
}

/**
 * Отправляет callback от inline-кнопки.
 */
export async function sendButtonCallback(
	client: MaxProtocolClient,
	chatId: string,
	messageId: string,
	callbackId: string,
	payload?: string,
): Promise<Record<string, unknown> | null> {
	const request = {
		chatId: toProtocolId(chatId, "chatId"),
		messageId: toProtocolId(messageId, "messageId"),
		callbackId,
		...(payload !== undefined && { payload }),
	};

	try {
		const response = await client.request(OPCODE.MSG_SEND_CALLBACK, request);
		return asRecord(response) ?? null;
	} catch {
		return null;
	}
}

// ============================================================================
// Скачивание медиа
// ============================================================================

/**
 * Скачивает фото по baseUrl и photoToken.
 */
export async function downloadPhoto(
	client: MaxProtocolClient,
	baseUrl: string,
	photoToken: string,
): Promise<Uint8Array | null> {
	try {
		const response = await client.request(OPCODE.FILE_DOWNLOAD, {
			url: baseUrl,
			token: photoToken,
		});
		const data = asRecord(response);
		const content = data?.content;
		if (content instanceof Uint8Array) return content;
		if (Array.isArray(content)) return Uint8Array.from(content);
		return null;
	} catch {
		return null;
	}
}

/**
 * Получает URL фото (для прямой ссылки).
 */
export async function getPhotoUrl(
	client: MaxProtocolClient,
	baseUrl: string,
	photoToken: string,
): Promise<string | null> {
	try {
		const response = await client.request(OPCODE.FILE_DOWNLOAD, {
			url: baseUrl,
			token: photoToken,
		});
		const data = asRecord(response);
		return typeof data?.content === "string" ? data.content : null;
	} catch {
		return null;
	}
}

/**
 * Получает URL'ы источников видео разных качеств.
 */
export async function getVideoSources(
	client: MaxProtocolClient,
	messageId: string,
	chatId: string,
	token: string,
	videoId: number,
): Promise<Record<string, string>> {
	try {
		const response = await client.request(OPCODE.VIDEO_PLAY, {
			messageId: toProtocolId(messageId, "messageId"),
			chatId: toProtocolId(chatId, "chatId"),
			token,
			videoId,
		});
		const data = asRecord(response);
		if (!data) return {};

		const mp4Keys = {
			MP4_1080: "1080p",
			MP4_720: "720p",
			MP4_480: "480p",
			MP4_360: "360p",
			MP4_240: "240p",
			MP4_144: "144p",
		};

		const sources: Record<string, string> = {};
		for (const [key, label] of Object.entries(mp4Keys)) {
			const url = data[key];
			if (typeof url === "string" && url) sources[label] = url;
		}

		if (Object.keys(sources).length === 0) {
			const hls = data.HLS;
			if (typeof hls === "string" && hls) sources.Авто = hls;
			const external = data.EXTERNAL;
			if (typeof external === "string" && external) {
				sources.Источник = external;
			}
		}

		return sources;
	} catch {
		return {};
	}
}

/**
 * Получает URL видео (первый доступный источник).
 */
export async function getVideoUrl(
	client: MaxProtocolClient,
	messageId: string,
	chatId: string,
	token: string,
	videoId: number,
): Promise<string | null> {
	const sources = await getVideoSources(
		client,
		messageId,
		chatId,
		token,
		videoId,
	);
	const values = Object.values(sources);
	return values.length > 0 ? (values[0] ?? null) : null;
}

/**
 * Скачивает видео по baseUrl и videoToken.
 */
export async function downloadVideo(
	client: MaxProtocolClient,
	baseUrl: string,
	videoToken: string,
): Promise<Uint8Array | null> {
	try {
		const response = await client.request(OPCODE.FILE_DOWNLOAD, {
			url: baseUrl,
			token: videoToken,
		});
		const data = asRecord(response);
		const content = data?.content;
		if (content instanceof Uint8Array) return content;
		if (Array.isArray(content)) return Uint8Array.from(content);
		return null;
	} catch {
		return null;
	}
}

/**
 * Скачивает файл по baseUrl и fileToken.
 */
export async function downloadFile(
	client: MaxProtocolClient,
	baseUrl: string,
	fileToken: string,
): Promise<Uint8Array | null> {
	try {
		const response = await client.request(OPCODE.FILE_DOWNLOAD, {
			url: baseUrl,
			token: fileToken,
		});
		const data = asRecord(response);
		const content = data?.content;
		if (content instanceof Uint8Array) return content;
		if (Array.isArray(content)) return Uint8Array.from(content);
		return null;
	} catch {
		return null;
	}
}

/**
 * Получает URL для скачивания файла.
 */
export async function getFileUrl(
	client: MaxProtocolClient,
	messageId: string,
	chatId: string,
	fileId: number,
): Promise<string | null> {
	try {
		const response = await client.request(OPCODE.FILE_DOWNLOAD, {
			messageId: toProtocolId(messageId, "messageId"),
			chatId: toProtocolId(chatId, "chatId"),
			fileId,
		});
		const data = asRecord(response);
		return typeof data?.url === "string" ? data.url : null;
	} catch {
		return null;
	}
}

/**
 * Запрашивает расшифровку аудиосообщения.
 */
export async function requestAudioTranscription(
	client: MaxProtocolClient,
	chatId: string,
	messageId: string,
	mediaId: number,
): Promise<{ status: number; text?: string } | null> {
	try {
		const response = await client.request(OPCODE.AUDIO_TRANSCRIPTION, {
			chatId: toProtocolId(chatId, "chatId"),
			messageId: toProtocolId(messageId, "messageId"),
			mediaId,
		});
		const data = asRecord(response);
		if (!data) return null;

		const status =
			typeof data.transcriptionStatus === "number"
				? data.transcriptionStatus
				: -1;

		if (status === 1) {
			const text =
				typeof data.transcription === "string" ? data.transcription : "";
			return { status, text: text || "не удалось распознать текст" };
		}

		return { status };
	} catch {
		return null;
	}
}
