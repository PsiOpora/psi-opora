import { and, asc, desc, eq, gt } from "drizzle-orm";
import type { Database } from "../client.types";
import { botMessages } from "../schema/bot-messages";

export type BotMessage = typeof botMessages.$inferSelect;
export type NewBotMessage = typeof botMessages.$inferInsert;

export interface BotMessageEntry {
  messenger: string;
  userId: string;
  direction: "in" | "out";
  source: "scenario" | "reminder" | "widget" | "broadcast";
  text: string;
}

export async function insertBotMessage(
  db: Database,
  entry: BotMessageEntry,
): Promise<void> {
  if (!db) return;
  await db.insert(botMessages).values({
    id: crypto.randomUUID(),
    messenger: entry.messenger,
    userId: entry.userId,
    direction: entry.direction,
    source: entry.source,
    text: entry.text,
    createdAt: new Date(),
  });
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

/** Сообщения диалога, появившиеся после `since` (старые выше) — для поллинга виджета. */
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
        gt(botMessages.createdAt, since),
      ),
    )
    .orderBy(asc(botMessages.createdAt))
    .limit(limit);
}
