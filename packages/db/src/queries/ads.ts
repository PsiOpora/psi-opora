import { and, eq, sql } from "drizzle-orm";
import { db } from "../client";

import {
	adCampaignIdOverrides,
	adCredentials,
	adDailyStats,
} from "../schema/ads";

export type AdCredentials = typeof adCredentials.$inferSelect;
export type NewAdCredentials = typeof adCredentials.$inferInsert;
export type AdDailyStats = typeof adDailyStats.$inferSelect;
export type NewAdDailyStats = typeof adDailyStats.$inferInsert;
export type AdCampaignIdOverride = typeof adCampaignIdOverrides.$inferSelect;

// ── Credentials ────────────────────────────────────────────────────────────────

export async function getAdCredentials(): Promise<AdCredentials | null> {
	if (!db) return null;
	const rows = await db.select().from(adCredentials).limit(1);
	return rows[0] ?? null;
}

export async function upsertAdCredentials(data: {
	yandexClientId?: string | null;
	yandexClientSecret?: string | null;
	yandexRefreshToken?: string | null;
}): Promise<void> {
	if (!db) return;
	await db
		.insert(adCredentials)
		.values({ id: "singleton", ...data })
		.onConflictDoUpdate({ target: adCredentials.id, set: data });
}

// ── Daily Stats ───────────────────────────────────────────────────────────────

export async function upsertAdDailyStats(
	rows: NewAdDailyStats[],
): Promise<void> {
	if (!db || rows.length === 0) return;
	await db
		.insert(adDailyStats)
		.values(rows)
		.onConflictDoUpdate({
			target: adDailyStats.id,
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
		.from(adDailyStats)
		.where(
			and(
				sql`${adDailyStats.date} >= ${fromDate}`,
				sql`${adDailyStats.date} <= ${toDate}`,
			),
		)
		.orderBy(adDailyStats.date);
}

export async function getAdStatsSummary(
	fromDate: string,
	toDate: string,
): Promise<{
	totalSpend: number;
	totalImpressions: number;
	totalClicks: number;
}> {
	if (!db) return { totalSpend: 0, totalImpressions: 0, totalClicks: 0 };
	const result = await db
		.select({
			totalSpend: sql<number>`coalesce(sum(${adDailyStats.spend}), 0) / 100.0`,
			totalImpressions: sql<number>`coalesce(sum(${adDailyStats.impressions}), 0)`,
			totalClicks: sql<number>`coalesce(sum(${adDailyStats.clicks}), 0)`,
		})
		.from(adDailyStats)
		.where(
			and(
				sql`${adDailyStats.date} >= ${fromDate}`,
				sql`${adDailyStats.date} <= ${toDate}`,
			),
		);
	return result[0] ?? { totalSpend: 0, totalImpressions: 0, totalClicks: 0 };
}

// ── Ручные привязки UTM-кампания → ID кампании в кабинете ──────────────────────

export async function getAdCampaignIdOverrides(): Promise<
	AdCampaignIdOverride[]
> {
	if (!db) return [];
	return db
		.select()
		.from(adCampaignIdOverrides)
		.orderBy(adCampaignIdOverrides.utmCampaign);
}

export async function upsertAdCampaignIdOverride(
	utmCampaign: string,
	adCampaignId: string,
): Promise<void> {
	if (!db) return;
	await db
		.insert(adCampaignIdOverrides)
		.values({ utmCampaign, adCampaignId })
		.onConflictDoUpdate({
			target: adCampaignIdOverrides.utmCampaign,
			set: { adCampaignId, updatedAt: sql`now()` },
		});
}

export async function deleteAdCampaignIdOverride(
	utmCampaign: string,
): Promise<void> {
	if (!db) return;
	await db
		.delete(adCampaignIdOverrides)
		.where(eq(adCampaignIdOverrides.utmCampaign, utmCampaign));
}
