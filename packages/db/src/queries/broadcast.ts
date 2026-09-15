import { desc, eq } from "drizzle-orm";
import { db } from "../client";
import { broadcastRecipients, broadcasts } from "../schema/broadcast";

export type Broadcast = typeof broadcasts.$inferSelect;
export type BroadcastRecipientRow = typeof broadcastRecipients.$inferSelect;
export type NewBroadcastRecipient = typeof broadcastRecipients.$inferInsert;

export async function createBroadcast(data: {
	id: string;
	stageId: string;
	stageName?: string;
	channel: string;
	message: string;
	totalDeals?: number;
}): Promise<void> {
	if (!db) return;
	await db.insert(broadcasts).values({ ...data, status: "running" });
}

/** Возврат рассылки в статус running — перед фоновой досылкой по ошибкам. */
export async function markBroadcastRunning(id: string): Promise<void> {
	if (!db) return;
	await db
		.update(broadcasts)
		.set({ status: "running", error: null, finishedAt: null })
		.where(eq(broadcasts.id, id));
}

export async function finishBroadcast(
	id: string,
	data: {
		status: "done" | "error";
		totalDeals?: number;
		sentCount?: number;
		skippedCount?: number;
		failedCount?: number;
		error?: string;
	},
): Promise<void> {
	if (!db) return;
	await db
		.update(broadcasts)
		.set({ ...data, finishedAt: new Date() })
		.where(eq(broadcasts.id, id));
}

export async function insertBroadcastRecipients(
	rows: NewBroadcastRecipient[],
): Promise<void> {
	if (!db || rows.length === 0) return;
	await db.insert(broadcastRecipients).values(rows);
}

export async function listBroadcasts(limit = 30): Promise<Broadcast[]> {
	if (!db) return [];
	return db
		.select()
		.from(broadcasts)
		.orderBy(desc(broadcasts.startedAt))
		.limit(limit);
}

/** Последняя реальная рассылка по стадии — для предупреждения о дубле. */
export async function getLastBroadcastForStage(
	stageId: string,
): Promise<Broadcast | null> {
	if (!db) return null;
	const rows = await db
		.select()
		.from(broadcasts)
		.where(eq(broadcasts.stageId, stageId))
		.orderBy(desc(broadcasts.startedAt))
		.limit(1);
	return rows[0] ?? null;
}

/** Обновление статуса получателя после досылки. */
export async function updateBroadcastRecipient(
	id: string,
	data: {
		status: "sent" | "error";
		error: string | null;
		sentAt: Date | null;
	},
): Promise<void> {
	if (!db) return;
	await db
		.update(broadcastRecipients)
		.set(data)
		.where(eq(broadcastRecipients.id, id));
}

export async function updateBroadcastCounters(
	id: string,
	data: { sentCount: number; failedCount: number },
): Promise<void> {
	if (!db) return;
	await db.update(broadcasts).set(data).where(eq(broadcasts.id, id));
}

export async function getBroadcast(id: string): Promise<Broadcast | null> {
	if (!db) return null;
	const rows = await db
		.select()
		.from(broadcasts)
		.where(eq(broadcasts.id, id))
		.limit(1);
	return rows[0] ?? null;
}

export async function listBroadcastRecipients(
	broadcastId: string,
): Promise<BroadcastRecipientRow[]> {
	if (!db) return [];
	return db
		.select()
		.from(broadcastRecipients)
		.where(eq(broadcastRecipients.broadcastId, broadcastId))
		.orderBy(broadcastRecipients.contactName);
}
