import { asc, eq, sql } from "drizzle-orm";
import type { Database } from "../client.types";
import { botGuideCampaigns } from "../schema/bot-guide-campaigns";
import { marketingCampaigns } from "../schema/marketing-campaigns";

export type MarketingCampaign = typeof marketingCampaigns.$inferSelect;
export type NewMarketingCampaign = typeof marketingCampaigns.$inferInsert;

export async function listMarketingCampaigns(
	db: Database,
): Promise<MarketingCampaign[]> {
	if (!db) return [];
	return db
		.select()
		.from(marketingCampaigns)
		.orderBy(asc(marketingCampaigns.createdAt));
}

/** Активная кампания по кодовому слову; сравнение регистронезависимое. */
export async function getMarketingCampaignByCode(
	db: Database,
	code: string,
): Promise<MarketingCampaign | null> {
	if (!db) return null;
	const rows = await db
		.select()
		.from(marketingCampaigns)
		.where(
			sql`lower(${marketingCampaigns.code}) = lower(${code.trim()}) and ${marketingCampaigns.active} = true`,
		)
		.limit(1);
	return rows[0] ?? null;
}

/**
 * Кодовое слово уже занято кампанией гайда: бот проверяет гайд-кампании
 * раньше, поэтому такая маркетинговая кампания никогда бы не сработала.
 */
export async function isGuideCampaignKeywordTaken(
	db: Database,
	code: string,
): Promise<boolean> {
	if (!db) return false;
	const rows = await db
		.select({ id: botGuideCampaigns.id })
		.from(botGuideCampaigns)
		.where(sql`lower(${botGuideCampaigns.keyword}) = lower(${code.trim()})`)
		.limit(1);
	return rows.length > 0;
}

export async function createMarketingCampaign(
	db: Database,
	campaign: NewMarketingCampaign,
): Promise<void> {
	if (!db) return;
	await db.insert(marketingCampaigns).values(campaign);
}

export async function updateMarketingCampaign(
	db: Database,
	id: string,
	patch: Partial<Omit<NewMarketingCampaign, "id">>,
): Promise<void> {
	if (!db) return;
	await db
		.update(marketingCampaigns)
		.set({ ...patch, updatedAt: sql`now()` })
		.where(eq(marketingCampaigns.id, id));
}

export async function deleteMarketingCampaign(
	db: Database,
	id: string,
): Promise<void> {
	if (!db) return;
	await db.delete(marketingCampaigns).where(eq(marketingCampaigns.id, id));
}
