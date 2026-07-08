import { sql } from "drizzle-orm";
import type { Database } from "../client";
import { botFunnelEvents } from "../schema/bot-funnel";

export type BotFunnelEvent = typeof botFunnelEvents.$inferSelect;
export type NewBotFunnelEvent = typeof botFunnelEvents.$inferInsert;

function makeId(
  day: string,
  messenger: string,
  step: string,
  source: string,
  campaign: string,
): string {
  return `${day}:${messenger}:${step}:${source}:${campaign}`;
}

export async function upsertBotFunnelEvent(
  db: Database,
  data: {
    day: string;
    messenger: string;
    step: string;
    source?: string;
    campaign?: string;
  },
): Promise<void> {
  if (!db) return;

  const source = data.source || "-";
  const campaign = data.campaign || "-";
  const id = makeId(data.day, data.messenger, data.step, source, campaign);

  await db
    .insert(botFunnelEvents)
    .values({
      id,
      day: data.day,
      messenger: data.messenger,
      step: data.step,
      source,
      campaign,
      count: 1,
    })
    .onConflictDoUpdate({
      target: botFunnelEvents.id,
      set: {
        count: sql`${botFunnelEvents.count} + 1`,
        updatedAt: sql`now()`,
      },
    });
}

export async function getBotFunnelEventsByDateRange(
  db: Database,
  fromDate: string,
  toDate: string,
): Promise<BotFunnelEvent[]> {
  if (!db) return [];
  return db
    .select()
    .from(botFunnelEvents)
    .where(
      sql`${botFunnelEvents.day} >= ${fromDate} AND ${botFunnelEvents.day} <= ${toDate}`,
    )
    .orderBy(
      botFunnelEvents.day,
      botFunnelEvents.messenger,
      botFunnelEvents.step,
    );
}
