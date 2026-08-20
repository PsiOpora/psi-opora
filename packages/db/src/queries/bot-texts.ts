import { inArray, sql } from "drizzle-orm";
import type { Database } from "../client.types";
import { botTexts } from "../schema/bot-texts";

export type BotText = typeof botTexts.$inferSelect;

/** Все переопределённые тексты бота как record key → value. */
export async function getBotTextsRecord(
	db: Database,
): Promise<Record<string, string>> {
	if (!db) return {};
	const rows = await db.select().from(botTexts);
	return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

/**
 * Сохраняет тексты бота. Пустое значение удаляет переопределение —
 * бот вернётся к тексту по умолчанию.
 */
export async function saveBotTexts(
	db: Database,
	entries: Record<string, string>,
): Promise<void> {
	if (!db) return;

	const toDelete = Object.keys(entries).filter((key) => !entries[key]?.trim());
	const toUpsert = Object.entries(entries)
		.filter(([, value]) => value.trim())
		.map(([key, value]) => ({ key, value }));

	if (toDelete.length > 0) {
		await db.delete(botTexts).where(inArray(botTexts.key, toDelete));
	}
	if (toUpsert.length > 0) {
		await db
			.insert(botTexts)
			.values(toUpsert)
			.onConflictDoUpdate({
				target: botTexts.key,
				set: {
					value: sql`excluded.value`,
					updatedAt: sql`now()`,
				},
			});
	}
}
