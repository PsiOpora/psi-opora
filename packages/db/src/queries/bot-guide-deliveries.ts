import { and, eq, isNull, sql } from "drizzle-orm";
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

function deliveryId(messenger: string, userId: string, campaignId: string): string {
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
