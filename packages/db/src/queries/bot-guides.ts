import { asc, eq } from "drizzle-orm";
import { db } from "../client";
import { botGuides } from "../schema/bot-guides";

export type BotGuide = typeof botGuides.$inferSelect;
export type NewBotGuide = typeof botGuides.$inferInsert;

export async function listBotGuides(): Promise<BotGuide[]> {
	if (!db) return [];
	return db.select().from(botGuides).orderBy(asc(botGuides.createdAt));
}

export async function getBotGuide(id: string): Promise<BotGuide | null> {
	if (!db) return null;
	const rows = await db
		.select()
		.from(botGuides)
		.where(eq(botGuides.id, id))
		.limit(1);
	return rows[0] ?? null;
}

export async function createBotGuide(guide: NewBotGuide): Promise<void> {
	if (!db) return;
	await db.insert(botGuides).values(guide);
}

export async function deleteBotGuide(id: string): Promise<void> {
	if (!db) return;
	await db.delete(botGuides).where(eq(botGuides.id, id));
}
