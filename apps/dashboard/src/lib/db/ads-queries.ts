import { eq, and, sql } from "drizzle-orm";
import { db, schema } from "./index";
import type { adCredentials, adDailyStats } from "./schema";

const { adCredentials: adCredsTable, adDailyStats: adStatsTable } = schema;

export type AdCredentials = typeof adCredsTable.$inferSelect;
export type NewAdCredentials = typeof adCredsTable.$inferInsert;
export type AdDailyStats = typeof adStatsTable.$inferSelect;
export type NewAdDailyStats = typeof adStatsTable.$inferInsert;

// ── Credentials ────────────────────────────────────────────────────────────────

export async function getAdCredentials(): Promise<AdCredentials | null> {
  if (!db) return null;
  const rows = await db.select().from(adCredsTable).limit(1);
  return rows[0] ?? null;
}

export async function upsertAdCredentials(data: {
  yandexClientId?: string | null;
  yandexClientSecret?: string | null;
  yandexRefreshToken?: string | null;
  vkAccessToken?: string | null;
  vkAdsAccountId?: string | null;
}): Promise<void> {
  if (!db) return;
  await db
    .insert(adCredsTable)
    .values({ id: "singleton", ...data })
    .onConflictDoUpdate({ target: adCredsTable.id, set: data });
}

// ── Daily Stats ───────────────────────────────────────────────────────────────

export async function upsertAdDailyStats(rows: NewAdDailyStats[]): Promise<void> {
  if (!db || rows.length === 0) return;
  await db
    .insert(adStatsTable)
    .values(rows)
    .onConflictDoUpdate({
      target: adStatsTable.id,
      set: {
        impressions: sql`excluded.impressions`,
        clicks: sql`excluded.clicks`,
        spend: sql`excluded.spend`,
        fetchedAt: sql`excluded.fetched_at`,
      },
    });
}

export async function getAdStatsByDateRange(
  fromDate: string,
  toDate: string,
): Promise<AdDailyStats[]> {
  if (!db) return [];
  return db
    .select()
    .from(adStatsTable)
    .where(and(sql`${adStatsTable.date} >= ${fromDate}`, sql`${adStatsTable.date} <= ${toDate}`))
    .orderBy(adStatsTable.date);
}

export async function getAdStatsSummary(
  fromDate: string,
  toDate: string,
): Promise<{ totalSpend: number; totalImpressions: number; totalClicks: number }> {
  if (!db) return { totalSpend: 0, totalImpressions: 0, totalClicks: 0 };
  const result = await db
    .select({
      totalSpend: sql<number>`coalesce(sum(${adStatsTable.spend}), 0) / 100.0`,
      totalImpressions: sql<number>`coalesce(sum(${adStatsTable.impressions}), 0)`,
      totalClicks: sql<number>`coalesce(sum(${adStatsTable.clicks}), 0)`,
    })
    .from(adStatsTable)
    .where(and(sql`${adStatsTable.date} >= ${fromDate}`, sql`${adStatsTable.date} <= ${toDate}`));
  return result[0] ?? { totalSpend: 0, totalImpressions: 0, totalClicks: 0 };
}
