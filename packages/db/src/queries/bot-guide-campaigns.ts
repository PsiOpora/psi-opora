import { asc, eq, sql } from "drizzle-orm";
import type { Database } from "../client.types";
import { botGuideCampaigns } from "../schema/bot-guide-campaigns";

export type BotGuideCampaign = typeof botGuideCampaigns.$inferSelect;
export type NewBotGuideCampaign = typeof botGuideCampaigns.$inferInsert;

export async function listBotGuideCampaigns(
  db: Database,
): Promise<BotGuideCampaign[]> {
  if (!db) return [];
  return db
    .select()
    .from(botGuideCampaigns)
    .orderBy(asc(botGuideCampaigns.createdAt));
}

export async function getBotGuideCampaign(
  db: Database,
  id: string,
): Promise<BotGuideCampaign | null> {
  if (!db) return null;
  const rows = await db
    .select()
    .from(botGuideCampaigns)
    .where(eq(botGuideCampaigns.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** Активная кампания по кодовому слову; сравнение регистронезависимое. */
export async function getBotGuideCampaignByKeyword(
  db: Database,
  keyword: string,
): Promise<BotGuideCampaign | null> {
  if (!db) return null;
  const rows = await db
    .select()
    .from(botGuideCampaigns)
    .where(
      sql`lower(${botGuideCampaigns.keyword}) = lower(${keyword.trim()}) and ${botGuideCampaigns.active} = true`,
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function createBotGuideCampaign(
  db: Database,
  campaign: NewBotGuideCampaign,
): Promise<void> {
  if (!db) return;
  await db.insert(botGuideCampaigns).values(campaign);
}

export async function updateBotGuideCampaign(
  db: Database,
  id: string,
  patch: Partial<Omit<NewBotGuideCampaign, "id">>,
): Promise<void> {
  if (!db) return;
  await db
    .update(botGuideCampaigns)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(botGuideCampaigns.id, id));
}

export async function deleteBotGuideCampaign(
  db: Database,
  id: string,
): Promise<void> {
  if (!db) return;
  await db.delete(botGuideCampaigns).where(eq(botGuideCampaigns.id, id));
}
