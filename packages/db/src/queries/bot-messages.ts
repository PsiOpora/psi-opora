import {
	and,
	asc,
	desc,
	eq,
	gt,
	isNotNull,
	isNull,
	or,
	sql,
} from "drizzle-orm";
import type { Database } from "../client.types";
import { botConversations } from "../schema/bot-conversations";
import { botMessages } from "../schema/bot-messages";
import { botUsers } from "../schema/bot-users";

export type BotMessage = typeof botMessages.$inferSelect;
export type NewBotMessage = typeof botMessages.$inferInsert;

/** Доставку/прочтение отдаёт сейчас только WAHA (WhatsApp) — для остальных
 * каналов статус не поднимается выше "sent". */
export type MessageDeliveryStatus = "sent" | "delivered" | "read" | "failed";

export interface BotMessageEntry {
	id?: string;
	messenger: string;
	userId: string;
	direction: "in" | "out";
	source: "scenario" | "reminder" | "widget" | "broadcast" | "operator";
	text: string;
	/** Bitrix-ID/имя оператора, реально написавшего сообщение — для
	 * source="operator" и source="widget" (см. bot-messages/index.ts). */
	operatorId?: string;
	operatorName?: string;
	/** По умолчанию "sent". */
	status?: MessageDeliveryStatus;
	/** ID сообщения во внешней системе: ack WAHA / редактирование TG и MAX. */
	externalId?: string;
	externalChatId?: string;
	/** Внутренний ID исходного ответа оператора в Bitrix. */
	bitrixMessageId?: number;
	/** ID зеркала, переданный в imconnector.send.messages. */
	bitrixExternalId?: string;
	/** Только для telegram-personal/whatsapp-personal — какой из нескольких
	 * личных номеров портала отправил/принял сообщение. */
	connectorId?: string;
	/** По умолчанию "text". "voice" — заливаем mediaS3Key в раздающий роут
	 * (apps/dashboard/src/app/api/message-media). */
	kind?: "text" | "voice";
	mediaS3Key?: string;
	mediaMimeType?: string;
	mediaDurationSec?: number;
}

export async function insertBotMessage(
	db: Database,
	entry: BotMessageEntry,
): Promise<string | undefined> {
	if (!db) return undefined;
	const now = new Date();
	const id = entry.id ?? crypto.randomUUID();
	await db.insert(botMessages).values({
		id,
		messenger: entry.messenger,
		userId: entry.userId,
		direction: entry.direction,
		source: entry.source,
		text: entry.text,
		operatorId: entry.operatorId,
		operatorName: entry.operatorName,
		status: entry.status ?? "sent",
		externalId: entry.externalId,
		externalChatId: entry.externalChatId,
		bitrixMessageId: entry.bitrixMessageId,
		bitrixExternalId: entry.bitrixExternalId,
		connectorId: entry.connectorId,
		kind: entry.kind ?? "text",
		mediaS3Key: entry.mediaS3Key,
		mediaMimeType: entry.mediaMimeType,
		mediaDurationSec: entry.mediaDurationSec,
		createdAt: now,
		updatedAt: now,
	});
	return id;
}

export interface BotMessageMedia {
	mediaS3Key: string;
	mediaMimeType: string | null;
}

/** Ключ и mime-type голосового вложения по id сообщения — для раздающего
 * роута apps/dashboard/src/app/api/message-media/[id]. */
export async function getBotMessageMedia(
	db: Database,
	id: string,
): Promise<BotMessageMedia | null> {
	if (!db) return null;
	const [row] = await db
		.select({
			mediaS3Key: botMessages.mediaS3Key,
			mediaMimeType: botMessages.mediaMimeType,
		})
		.from(botMessages)
		.where(and(eq(botMessages.id, id), isNull(botMessages.deletedAt)))
		.limit(1);
	if (!row?.mediaS3Key) return null;
	return { mediaS3Key: row.mediaS3Key, mediaMimeType: row.mediaMimeType };
}

/** Обновляет статус доставки по внешнему id сообщения (сейчас — только
 * WAHA-вебхук `message.ack`). */
export async function updateBotMessageStatus(
	db: Database,
	externalId: string,
	status: MessageDeliveryStatus,
): Promise<void> {
	if (!db) return;
	await db
		.update(botMessages)
		.set({ status, updatedAt: new Date() })
		.where(eq(botMessages.externalId, externalId));
}

/** Возвращает текстовое сообщение, которое текущий оператор вправе изменить. */
export async function getEditableBotMessage(
	db: Database,
	id: string,
	operatorId: string,
): Promise<BotMessage | null> {
	if (!db) return null;
	const [row] = await db
		.select()
		.from(botMessages)
		.where(
			and(
				eq(botMessages.id, id),
				eq(botMessages.direction, "out"),
				eq(botMessages.kind, "text"),
				or(
					eq(botMessages.operatorId, operatorId),
					and(isNull(botMessages.operatorId), eq(botMessages.source, "widget")),
				),
				isNotNull(botMessages.externalId),
				isNull(botMessages.deletedAt),
			),
		)
		.limit(1);
	return row ?? null;
}

/** Дописывает внешний ID после асинхронной отправки личным Telegram-worker. */
export async function updateBotMessageExternalResult(
	db: Database,
	id: string,
	externalId: string | undefined,
	status: MessageDeliveryStatus,
): Promise<void> {
	if (!db) return;
	await db
		.update(botMessages)
		.set({ externalId, status, updatedAt: new Date() })
		.where(eq(botMessages.id, id));
}

/** Возвращает исходящее сообщение, которое текущий оператор вправе удалить. */
export async function getDeletableBotMessage(
	db: Database,
	id: string,
	operatorId: string,
): Promise<BotMessage | null> {
	if (!db) return null;
	const [row] = await db
		.select()
		.from(botMessages)
		.where(
			and(
				eq(botMessages.id, id),
				eq(botMessages.direction, "out"),
				or(
					eq(botMessages.operatorId, operatorId),
					and(isNull(botMessages.operatorId), eq(botMessages.source, "widget")),
				),
				isNotNull(botMessages.externalId),
				isNull(botMessages.deletedAt),
			),
		)
		.limit(1);
	return row ?? null;
}

/** Фиксирует текст после успешного редактирования во внешнем мессенджере. */
export async function updateBotMessageText(
	db: Database,
	id: string,
	text: string,
): Promise<BotMessage | null> {
	if (!db) return null;
	const now = new Date();
	const [row] = await db
		.update(botMessages)
		.set({ text, editedAt: now, updatedAt: now })
		.where(eq(botMessages.id, id))
		.returning();
	return row ?? null;
}

/** Отмечает сообщение удалённым, сохраняя исходный текст в БД для аудита. */
export async function markBotMessageDeleted(
	db: Database,
	id: string,
	operatorId: string,
): Promise<BotMessage | null> {
	if (!db) return null;
	const now = new Date();
	const [row] = await db
		.update(botMessages)
		.set({
			deletedAt: now,
			deletedByOperatorId: operatorId,
			updatedAt: now,
		})
		.where(and(eq(botMessages.id, id), isNull(botMessages.deletedAt)))
		.returning();
	return row ?? null;
}

export async function setBotMessageBitrixExternalId(
	db: Database,
	id: string,
	bitrixExternalId: string,
): Promise<void> {
	if (!db) return;
	await db
		.update(botMessages)
		.set({ bitrixExternalId, updatedAt: new Date() })
		.where(eq(botMessages.id, id));
}

/** Отмечает, что гайд-PDF из этого сообщения продублирован клиенту на email
 * (см. dispatchScenarioOutput/sendGuideEmail) — инбокс «Клиенты» показывает
 * это в треде. */
export async function markBotMessageGuideEmailSent(
	db: Database,
	id: string,
): Promise<void> {
	if (!db) return;
	const now = new Date();
	await db
		.update(botMessages)
		.set({ guideEmailSentAt: now, updatedAt: now })
		.where(eq(botMessages.id, id));
}

/** Последние сообщения диалога с клиентом (новые первыми). */
export async function listBotMessages(
	db: Database,
	messenger: string,
	userId: string,
	limit = 50,
): Promise<BotMessage[]> {
	if (!db) return [];
	return db
		.select()
		.from(botMessages)
		.where(
			and(eq(botMessages.messenger, messenger), eq(botMessages.userId, userId)),
		)
		.orderBy(desc(botMessages.createdAt))
		.limit(limit);
}

/** Сообщения диалога, появившиеся или изменившиеся (сменился status) после
 * `since` — для поллинга инбокса. Курсор по updatedAt, а не createdAt: иначе
 * статусный апдейт уже показанного сообщения (sent → delivered → read)
 * никогда не попадёт в открытый тред. */
export async function listBotMessagesSince(
	db: Database,
	messenger: string,
	userId: string,
	since: Date,
	limit = 50,
): Promise<BotMessage[]> {
	if (!db) return [];
	return db
		.select()
		.from(botMessages)
		.where(
			and(
				eq(botMessages.messenger, messenger),
				eq(botMessages.userId, userId),
				gt(botMessages.updatedAt, since),
			),
		)
		.orderBy(asc(botMessages.updatedAt))
		.limit(limit);
}

export interface ClientMessageStats {
	totalCount: number;
	inCount: number;
	outCount: number;
	firstMessageAt: Date | null;
	lastMessageAt: Date | null;
}

/** Сводка переписки с клиентом — для карточки профиля в инбоксе «Клиенты». */
export async function getClientMessageStats(
	db: Database,
	messenger: string,
	userId: string,
): Promise<ClientMessageStats> {
	const empty: ClientMessageStats = {
		totalCount: 0,
		inCount: 0,
		outCount: 0,
		firstMessageAt: null,
		lastMessageAt: null,
	};
	if (!db) return empty;
	const [row] = await db
		.select({
			totalCount: sql<number>`count(*)::int`,
			inCount: sql<number>`count(*) filter (where ${botMessages.direction} = 'in')::int`,
			outCount: sql<number>`count(*) filter (where ${botMessages.direction} = 'out')::int`,
			firstMessageAt: sql<Date | null>`min(${botMessages.createdAt})`,
			lastMessageAt: sql<Date | null>`max(${botMessages.createdAt})`,
		})
		.from(botMessages)
		.where(
			and(eq(botMessages.messenger, messenger), eq(botMessages.userId, userId)),
		);
	return row ?? empty;
}

export interface ClientListItem {
	messenger: string;
	userId: string;
	name: string | null;
	username: string | null;
	hasAvatar: boolean;
	lastMessageText: string;
	lastMessageDirection: "in" | "out";
	lastMessageAt: Date;
	unread: boolean;
	/** Число входящих сообщений после lastReadAt — бейдж-кружок в списке, как в Wazzup. */
	unreadCount: number;
	assignedOperatorId: string | null;
	assignedOperatorName: string | null;
	tags: string[];
}

/**
 * Клиенты, у которых есть переписка, с последним сообщением и метаданными
 * инбокса — для списка «Клиенты» в дашборде (packages/api routers/messages).
 * Сортировка — по свежести последнего сообщения.
 */
export async function listClientsWithLastMessage(
	db: Database,
	options: { limit?: number; offset?: number; search?: string } = {},
): Promise<ClientListItem[]> {
	if (!db) return [];
	const { limit = 50, offset = 0, search } = options;

	const lastMessage = db
		.selectDistinctOn([botMessages.messenger, botMessages.userId], {
			messenger: botMessages.messenger,
			userId: botMessages.userId,
			text: sql<string>`case when ${botMessages.deletedAt} is not null then 'Сообщение удалено' else ${botMessages.text} end`.as(
				"text",
			),
			direction: botMessages.direction,
			createdAt: botMessages.createdAt,
		})
		.from(botMessages)
		.orderBy(
			botMessages.messenger,
			botMessages.userId,
			desc(botMessages.createdAt),
		)
		.as("last_message");

	const searchFilter = search?.trim()
		? sql`(${botUsers.name} ilike ${`%${search.trim()}%`} or ${botUsers.username} ilike ${`%${search.trim()}%`})`
		: undefined;

	const rows = await db
		.select({
			messenger: lastMessage.messenger,
			userId: lastMessage.userId,
			name: botUsers.name,
			username: botUsers.username,
			hasAvatar: sql<boolean>`${botUsers.avatarS3Key} is not null`,
			lastMessageText: lastMessage.text,
			lastMessageDirection: lastMessage.direction,
			lastMessageAt: lastMessage.createdAt,
			assignedOperatorId: botConversations.assignedOperatorId,
			assignedOperatorName: botConversations.assignedOperatorName,
			tags: botConversations.tags,
			// Точное число непрочитанных, а не только флаг «есть ли» — бейдж в
			// списке (как в Wazzup) показывает именно счётчик, а не точку.
			unreadCount: sql<number>`(
        select count(*)::int from bot_messages
        where bot_messages.messenger = ${lastMessage.messenger}
          and bot_messages.user_id = ${lastMessage.userId}
          and bot_messages.direction = 'in'
          and bot_messages.created_at > coalesce(${botConversations.lastReadAt}, to_timestamp(0))
      )`,
		})
		.from(lastMessage)
		.leftJoin(
			botUsers,
			and(
				eq(botUsers.messenger, lastMessage.messenger),
				eq(botUsers.userId, lastMessage.userId),
			),
		)
		.leftJoin(
			botConversations,
			and(
				eq(botConversations.messenger, lastMessage.messenger),
				eq(botConversations.userId, lastMessage.userId),
			),
		)
		.where(searchFilter)
		.orderBy(desc(lastMessage.createdAt))
		.limit(limit)
		.offset(offset);

	return rows.map((row) => ({
		messenger: row.messenger,
		userId: row.userId,
		name: row.name,
		username: row.username,
		hasAvatar: row.hasAvatar,
		lastMessageText: row.lastMessageText,
		lastMessageDirection: row.lastMessageDirection as "in" | "out",
		lastMessageAt: row.lastMessageAt,
		unread: row.unreadCount > 0,
		unreadCount: row.unreadCount,
		assignedOperatorId: row.assignedOperatorId,
		assignedOperatorName: row.assignedOperatorName,
		tags: row.tags ?? [],
	}));
}
