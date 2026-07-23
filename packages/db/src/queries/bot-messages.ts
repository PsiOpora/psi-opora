import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
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
  messenger: string;
  userId: string;
  direction: "in" | "out";
  source: "scenario" | "reminder" | "widget" | "broadcast" | "operator";
  text: string;
  /** Bitrix-ID оператора — только для source="operator". */
  operatorId?: string;
  /** По умолчанию "sent". */
  status?: MessageDeliveryStatus;
  /** id сообщения во внешней системе (WAHA) — для сопоставления с ack-вебхуком. */
  externalId?: string;
}

export async function insertBotMessage(
  db: Database,
  entry: BotMessageEntry,
): Promise<void> {
  if (!db) return;
  const now = new Date();
  await db.insert(botMessages).values({
    id: crypto.randomUUID(),
    messenger: entry.messenger,
    userId: entry.userId,
    direction: entry.direction,
    source: entry.source,
    text: entry.text,
    operatorId: entry.operatorId,
    status: entry.status ?? "sent",
    externalId: entry.externalId,
    createdAt: now,
    updatedAt: now,
  });
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
  avatarUrl: string | null;
  lastMessageText: string;
  lastMessageDirection: "in" | "out";
  lastMessageAt: Date;
  unread: boolean;
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
      text: botMessages.text,
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
      avatarUrl: botUsers.avatarUrl,
      lastMessageText: lastMessage.text,
      lastMessageDirection: lastMessage.direction,
      lastMessageAt: lastMessage.createdAt,
      lastReadAt: botConversations.lastReadAt,
      assignedOperatorId: botConversations.assignedOperatorId,
      assignedOperatorName: botConversations.assignedOperatorName,
      tags: botConversations.tags,
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
    avatarUrl: row.avatarUrl,
    lastMessageText: row.lastMessageText,
    lastMessageDirection: row.lastMessageDirection as "in" | "out",
    lastMessageAt: row.lastMessageAt,
    unread:
      row.lastMessageDirection === "in" &&
      (!row.lastReadAt || row.lastMessageAt > row.lastReadAt),
    assignedOperatorId: row.assignedOperatorId,
    assignedOperatorName: row.assignedOperatorName,
    tags: row.tags ?? [],
  }));
}
