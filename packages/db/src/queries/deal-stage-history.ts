import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../client";
import {
	dealStageHistory,
	dealStageHistorySync,
} from "../schema/deal-stage-history";
import { deals } from "../schema/deals";

export type DealStageHistoryEvent = typeof dealStageHistory.$inferSelect;
export type NewDealStageHistoryEvent = typeof dealStageHistory.$inferInsert;

const SYNC_SINGLETON_ID = "singleton";

// ── Sync ─────────────────────────────────────────────────────────────────

/** Батч-вставка событий истории стадий — append-only, дедуп по id (Bitrix ID). */
export async function insertDealStageHistoryEvents(
	rows: NewDealStageHistoryEvent[],
): Promise<void> {
	if (!db || rows.length === 0) return;
	await db.insert(dealStageHistory).values(rows).onConflictDoNothing({
		target: dealStageHistory.id,
	});
}

/** Курсор инкрементальной синхронизации — null, если бэкафилл ещё не запускался. */
export async function getSyncCursor(): Promise<string | null> {
	if (!db) return null;
	const rows = await db
		.select({ lastSyncedId: dealStageHistorySync.lastSyncedId })
		.from(dealStageHistorySync)
		.where(eq(dealStageHistorySync.id, SYNC_SINGLETON_ID))
		.limit(1);
	return rows[0]?.lastSyncedId ?? null;
}

export async function setSyncCursor(lastSyncedId: string): Promise<void> {
	if (!db) return;
	// Conditional update: only advance cursor if new ID is lexicographically greater
	// (monotonic across portal). Prevents parallel syncs from writing stale cursor.
	await db
		.insert(dealStageHistorySync)
		.values({ id: SYNC_SINGLETON_ID, lastSyncedId, updatedAt: new Date() })
		.onConflictDoUpdate({
			target: dealStageHistorySync.id,
			set: { lastSyncedId, updatedAt: new Date() },
			where: sql`${dealStageHistorySync.lastSyncedId} IS NULL OR ${dealStageHistorySync.lastSyncedId} < ${lastSyncedId}`,
		});
}

// ── Report ───────────────────────────────────────────────────────────────

export interface StageReachCount {
	stageId: string;
	uniqueDeals: number;
}

/**
 * Кол-во уникальных сделок, побывавших на каждой стадии воронки за период.
 * Только сделки, которые есть в зеркале deals: история могла досинхронизироваться
 * уже после удаления сделки (deleteDeals её не застал) — такие не считаем,
 * иначе отчёт расходится со списком сделок стадии (listDeals.reachedStage).
 */
export async function getStageReachCounts(options: {
	categoryId: string;
	from: Date;
	to: Date;
}): Promise<StageReachCount[]> {
	if (!db) return [];
	return db
		.select({
			stageId: dealStageHistory.stageId,
			uniqueDeals: sql<number>`count(distinct ${dealStageHistory.dealId})::int`,
		})
		.from(dealStageHistory)
		.innerJoin(deals, eq(deals.id, dealStageHistory.dealId))
		.where(
			and(
				eq(dealStageHistory.categoryId, options.categoryId),
				gte(dealStageHistory.enteredAt, options.from),
				lte(dealStageHistory.enteredAt, options.to),
			),
		)
		.groupBy(dealStageHistory.stageId);
}
