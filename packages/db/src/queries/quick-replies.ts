import { asc, eq } from "drizzle-orm";
import type { Database } from "../client.types";
import { quickReplies } from "../schema/quick-replies";

export type QuickReply = typeof quickReplies.$inferSelect;

export async function listQuickReplies(db: Database): Promise<QuickReply[]> {
	if (!db) return [];
	return db.select().from(quickReplies).orderBy(asc(quickReplies.title));
}

/** Создаёт или обновляет шаблон (id не передан — создаём новый). */
export async function saveQuickReply(
	db: Database,
	entry: { id?: string; title: string; text: string },
): Promise<QuickReply | null> {
	if (!db) return null;
	const now = new Date();
	const [row] = await db
		.insert(quickReplies)
		.values({
			id: entry.id ?? crypto.randomUUID(),
			title: entry.title,
			text: entry.text,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: quickReplies.id,
			set: { title: entry.title, text: entry.text, updatedAt: now },
		})
		.returning();
	return row ?? null;
}

export async function deleteQuickReply(
	db: Database,
	id: string,
): Promise<void> {
	if (!db) return;
	await db.delete(quickReplies).where(eq(quickReplies.id, id));
}
