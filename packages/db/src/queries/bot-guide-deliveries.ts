import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "../client.types";
import { botGuideCampaigns } from "../schema/bot-guide-campaigns";
import { botGuideDeliveries } from "../schema/bot-guide-deliveries";

export type BotGuideDelivery = typeof botGuideDeliveries.$inferSelect;

export interface NewBotGuideDeliveryEntry {
  campaignId: string;
  messenger: string;
  userId: string;
  chatId?: string;
  dealId?: number;
  name?: string;
  phone?: string;
  email?: string;
}

function deliveryId(
  messenger: string,
  userId: string,
  campaignId: string,
): string {
  return `${messenger}:${userId}:${campaignId}`;
}

/**
 * Фиксирует выдачу материала. Одна выдача на пользователя в рамках
 * кампании — повторный вход по тому же кодовому слову не сдвигает таймер
 * follow-up (onConflictDoNothing).
 */
export async function upsertBotGuideDelivery(
  db: Database,
  entry: NewBotGuideDeliveryEntry,
): Promise<void> {
  if (!db) return;
  await db
    .insert(botGuideDeliveries)
    .values({
      id: deliveryId(entry.messenger, entry.userId, entry.campaignId),
      ...entry,
    })
    .onConflictDoNothing({ target: botGuideDeliveries.id });
}

export async function getBotGuideDelivery(
  db: Database,
  messenger: string,
  userId: string,
  campaignId: string,
): Promise<BotGuideDelivery | null> {
  if (!db) return null;
  const rows = await db
    .select()
    .from(botGuideDeliveries)
    .where(eq(botGuideDeliveries.id, deliveryId(messenger, userId, campaignId)))
    .limit(1);
  return rows[0] ?? null;
}

export interface DueGuideFollowUp {
  delivery: BotGuideDelivery;
  campaign: typeof botGuideCampaigns.$inferSelect;
}

/**
 * Выдачи, для которых пора слать follow-up: прошло не меньше
 * campaign.followUpDelayDays с момента deliveredAt, напоминание ещё не
 * отправлено, кампания активна.
 */
export async function listDueGuideFollowUps(
  db: Database,
): Promise<DueGuideFollowUp[]> {
  if (!db) return [];
  const rows = await db
    .select({
      delivery: botGuideDeliveries,
      campaign: botGuideCampaigns,
    })
    .from(botGuideDeliveries)
    .innerJoin(
      botGuideCampaigns,
      eq(botGuideCampaigns.id, botGuideDeliveries.campaignId),
    )
    .where(
      and(
        isNull(botGuideDeliveries.followUpSentAt),
        eq(botGuideCampaigns.active, true),
        sql`${botGuideDeliveries.deliveredAt} <= now() - (${botGuideCampaigns.followUpDelayDays} || ' days')::interval`,
      ),
    );
  return rows;
}

export async function markGuideFollowUpSent(
  db: Database,
  id: string,
): Promise<void> {
  if (!db) return;
  await db
    .update(botGuideDeliveries)
    .set({ followUpSentAt: sql`now()` })
    .where(eq(botGuideDeliveries.id, id));
}

/**
 * Последняя выдача гайда этому пользователю, для которой уже ушёл follow-up,
 * но заявка на диагностику ещё не оформлена — используется, когда клиент
 * соглашается на диагностику (кнопкой или текстом) после follow-up-сообщения.
 */
export async function getPendingGuideDiagnosticDelivery(
  db: Database,
  messenger: string,
  userId: string,
): Promise<BotGuideDelivery | null> {
  if (!db) return null;
  const rows = await db
    .select()
    .from(botGuideDeliveries)
    .where(
      and(
        eq(botGuideDeliveries.messenger, messenger),
        eq(botGuideDeliveries.userId, userId),
        sql`${botGuideDeliveries.followUpSentAt} is not null`,
        isNull(botGuideDeliveries.diagnosticRequestedAt),
      ),
    )
    .orderBy(desc(botGuideDeliveries.deliveredAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function markGuideDiagnosticRequested(
  db: Database,
  id: string,
  dealId?: number,
): Promise<void> {
  if (!db) return;
  await db
    .update(botGuideDeliveries)
    .set({
      diagnosticRequestedAt: sql`now()`,
      ...(dealId !== undefined ? { dealId } : {}),
    })
    .where(eq(botGuideDeliveries.id, id));
}

export interface GuideCampaignStats {
  campaignId: string;
  /** Сколько раз материал выдан (одна выдача на пользователя, см. deliveryId). */
  delivered: number;
  /** Скольким из них уже ушло follow-up-напоминание. */
  followUpSent: number;
  /** Сколько из них оставили заявку на диагностику после напоминания. */
  diagnosticRequested: number;
  /** Сколько человек реально открыли материал по ссылке из чата. */
  opened: number;
  /** Всего открытий (один человек мог возвращаться к файлу). */
  opens: number;
}

/**
 * Счётчики по каждой кампании для карточки в дашборде — заказчику важно
 * видеть отдачу кодового слова, а не только его настройки.
 */
export async function listGuideCampaignStats(
  db: Database,
): Promise<GuideCampaignStats[]> {
  if (!db) return [];
  const rows = await db
    .select({
      campaignId: botGuideDeliveries.campaignId,
      delivered: sql<number>`count(*)::int`,
      followUpSent: sql<number>`count(${botGuideDeliveries.followUpSentAt})::int`,
      diagnosticRequested: sql<number>`count(${botGuideDeliveries.diagnosticRequestedAt})::int`,
      opened: sql<number>`count(${botGuideDeliveries.firstOpenedAt})::int`,
      opens: sql<number>`coalesce(sum(${botGuideDeliveries.openCount}), 0)::int`,
    })
    .from(botGuideDeliveries)
    .groupBy(botGuideDeliveries.campaignId);
  return rows;
}
