import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../client.types";
import { botConversations } from "../schema/bot-conversations";

export type BotConversation = typeof botConversations.$inferSelect;

function makeId(messenger: string, userId: string): string {
  return `${messenger}:${userId}`;
}

/** Диалог отмечен прочитанным (общий курсор — не персональный на менеджера). */
export async function markConversationRead(
  db: Database,
  messenger: string,
  userId: string,
): Promise<void> {
  if (!db) return;
  const id = makeId(messenger, userId);
  await db
    .insert(botConversations)
    .values({ id, messenger, userId, lastReadAt: new Date() })
    .onConflictDoUpdate({
      target: botConversations.id,
      set: { lastReadAt: new Date(), updatedAt: new Date() },
    });
}

export interface ConversationAssignment {
  messenger: string;
  userId: string;
  operatorId: string;
  operatorName: string;
}

/** Назначает ответственного менеджера на диалог (перезаписывает предыдущего). */
export async function assignConversation(
  db: Database,
  entry: ConversationAssignment,
): Promise<void> {
  if (!db) return;
  const id = makeId(entry.messenger, entry.userId);
  await db
    .insert(botConversations)
    .values({
      id,
      messenger: entry.messenger,
      userId: entry.userId,
      assignedOperatorId: entry.operatorId,
      assignedOperatorName: entry.operatorName,
    })
    .onConflictDoUpdate({
      target: botConversations.id,
      set: {
        assignedOperatorId: entry.operatorId,
        assignedOperatorName: entry.operatorName,
        updatedAt: new Date(),
      },
    });
}

/**
 * Назначает ответственного, только если диалог ещё никому не назначен —
 * «первый ответивший — ответственный» (см. apps/bitrix-webhook, ответ
 * оператора прямо из Открытой линии Bitrix24).
 */
export async function assignConversationIfUnassigned(
  db: Database,
  entry: ConversationAssignment,
): Promise<void> {
  if (!db) return;
  const id = makeId(entry.messenger, entry.userId);
  await db
    .insert(botConversations)
    .values({
      id,
      messenger: entry.messenger,
      userId: entry.userId,
      assignedOperatorId: entry.operatorId,
      assignedOperatorName: entry.operatorName,
    })
    .onConflictDoUpdate({
      target: botConversations.id,
      set: {
        assignedOperatorId: entry.operatorId,
        assignedOperatorName: entry.operatorName,
        updatedAt: new Date(),
      },
      setWhere: isNull(botConversations.assignedOperatorId),
    });
}

/** Полностью заменяет набор тегов диалога (пустой массив — снять все теги). */
export async function setConversationTags(
  db: Database,
  messenger: string,
  userId: string,
  tags: string[],
): Promise<void> {
  if (!db) return;
  const id = makeId(messenger, userId);
  await db
    .insert(botConversations)
    .values({ id, messenger, userId, tags })
    .onConflictDoUpdate({
      target: botConversations.id,
      set: { tags, updatedAt: new Date() },
    });
}

export async function getConversationMeta(
  db: Database,
  messenger: string,
  userId: string,
): Promise<BotConversation | null> {
  if (!db) return null;
  const [row] = await db
    .select()
    .from(botConversations)
    .where(
      and(
        eq(botConversations.messenger, messenger),
        eq(botConversations.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}
