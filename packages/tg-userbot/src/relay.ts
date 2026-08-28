import { MemoryStorage, MtPeerNotFoundError, type tl } from "@mtcute/core";
import type { Message } from "@mtcute/node";
import { InputMedia, TelegramClient } from "@mtcute/node";
import type { TelegramApiCredentials } from "./login";

/** Фото/файл, уже скачанный из нашего S3 (см. packages/api/
 * message-attachment-storage.ts downloadOutboundAttachment) — передаётся
 * mtcute байтами напрямую, без промежуточного публичного URL. */
export interface UserbotMediaAttachment {
	bytes: Uint8Array;
	fileName: string;
	mimeType: string;
	kind: "image" | "file" | "voice";
}

export interface UserbotPresence {
	userId: number;
	status:
		| "online"
		| "offline"
		| "recently"
		| "within_week"
		| "within_month"
		| "long_time_ago"
		| "bot";
	lastOnline: Date | null;
}

/**
 * Используется воркером (Фаза 2, apps/tg-userbot-worker) — держит живой
 * MTProto-клиент личного аккаунта для приёма/отправки сообщений. В отличие
 * от login.ts (одноразовые короткие подключения на каждый шаг логина),
 * этот клиент остаётся подключённым постоянно (см. план — always-on
 * процесс, не serverless). apiId/apiHash/session — то, что было сохранено
 * для этого номера при подключении (packages/db телеgram_personal_accounts).
 */
export async function createUserbotClient(
	session: string,
	credentials: TelegramApiCredentials,
): Promise<TelegramClient> {
	const tg = new TelegramClient({
		apiId: credentials.apiId,
		apiHash: credentials.apiHash,
		storage: new MemoryStorage(),
	});
	await tg.importSession(session);
	return tg;
}

/**
 * Подписка на входящие личные сообщения. Точное имя события/сигнатура —
 * сверить с типами @mtcute/node при реализации Фазы 2 (воркер ещё не
 * подключён к реальному Bitrix24-порталу, чтобы протестировать вживую).
 */
export function listenForMessages(
	client: TelegramClient,
	onMessage: (message: Message) => void | Promise<void>,
): void {
	client.onNewMessage.add((message) => {
		if (message.isOutgoing) return;
		void onMessage(message);
	});
}

/** Подписка на MTProto updateUserStatus. Поток глобальный для аккаунта,
 * поэтому вызывающий код должен сохранять только уже известных клиентов. */
export function listenForUserPresence(
	client: TelegramClient,
	onPresence: (presence: UserbotPresence) => void | Promise<void>,
): void {
	client.onUserStatusUpdate.add((update) => {
		void onPresence({
			userId: update.userId,
			status: update.status,
			lastOnline: update.lastOnline,
		});
	});
}

/** Текущий presence пользователя после резолва/отправки первого сообщения. */
export async function getUserPresence(
	client: TelegramClient,
	target: number | tl.TypeInputPeer,
): Promise<UserbotPresence | null> {
	const [user] = await client.getUsers(target);
	if (!user) return null;
	return {
		userId: user.id,
		status: user.status,
		lastOnline: user.lastOnline,
	};
}

export async function sendUserbotMessage(
	client: TelegramClient,
	target: number | tl.TypeInputPeer,
	text: string,
): Promise<string> {
	const message = await client.sendText(target, text);
	return String(message.id);
}

/** Отправляет фото/файл (с опциональной подписью) через личный аккаунт. */
export async function sendUserbotMedia(
	client: TelegramClient,
	target: number | tl.TypeInputPeer,
	attachment: UserbotMediaAttachment,
	caption?: string,
): Promise<string> {
	const mediaType = attachment.mimeType.split(";", 1)[0]?.trim().toLowerCase();
	const sendAsVoice =
		attachment.kind === "voice" &&
		(mediaType === "audio/ogg" || mediaType === "audio/opus");
	const media =
		attachment.kind === "image"
			? InputMedia.photo(attachment.bytes, { caption })
			: sendAsVoice
				? InputMedia.voice(attachment.bytes, { caption })
				: InputMedia.document(attachment.bytes, {
						fileName: attachment.fileName,
						fileMime: attachment.mimeType,
						caption,
					});
	const message = await client.sendMedia(target, media);
	return String(message.id);
}

/** Отзывает сообщение личного аккаунта для обеих сторон диалога. */
export async function deleteUserbotMessage(
	client: TelegramClient,
	target: number | tl.TypeInputPeer,
	externalId: string,
): Promise<void> {
	await client.deleteMessagesById(target, [Number(externalId)], {
		revoke: true,
	});
}

/**
 * Резолвит номер телефона в Telegram-пира через официальный
 * `contacts.resolvePhone` (то же самое, что делает обычный клиент Telegram,
 * когда ищет человека по номеру) — так работает «написать клиенту первым»
 * (packages/api/src/routers/widget-message). Бросает читаемую ошибку, если
 * у номера нет Telegram-аккаунта либо владелец скрыл номер в настройках
 * приватности («Кто видит мой номер телефона»).
 */
export async function resolveClientPhoneNumber(
	client: TelegramClient,
	phone: string,
): Promise<tl.TypeInputPeer> {
	try {
		return await client.resolvePhoneNumber(phone);
	} catch (err) {
		if (err instanceof MtPeerNotFoundError) {
			throw new Error(
				"Клиент не найден в Telegram по этому номеру — либо у него нет Telegram, либо скрыт номер телефона в настройках приватности",
			);
		}
		throw err;
	}
}

/**
 * Резолвит username в Telegram-пира через `contacts.resolveUsername` (то же,
 * что делает поиск по @username в обычном клиенте) — альтернатива
 * resolveClientPhoneNumber, когда у контакта в CRM нет телефона, но есть
 * username (см. TelegramUsername_WZ и подобные UF-поля интеграций).
 */
export async function resolveClientUsername(
	client: TelegramClient,
	username: string,
): Promise<tl.TypeInputPeer> {
	const cleaned = username
		.trim()
		.replace(/^https?:\/\/t\.me\//i, "")
		.replace(/^@/, "");
	try {
		return await client.resolvePeer(cleaned);
	} catch (err) {
		if (err instanceof MtPeerNotFoundError) {
			throw new Error(`Клиент не найден в Telegram по username @${cleaned}`);
		}
		throw err;
	}
}
