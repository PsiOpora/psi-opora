import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../client";
import { adSearchQueryLookups, adTouches } from "../schema/ad-touches";

/** Ожидающий поиск запроса вместе с данными клика из касания. */
export interface PendingAdSearchQueryLookup {
	dealId: string;
	messenger: string;
	attempts: number;
	adGroupId: string | null;
	adId: string | null;
	keywordId: string | null;
	clickedAt: Date;
}

/** Ставит сделку в очередь поиска запроса; повтор для той же сделки игнорируется. */
export async function insertAdSearchQueryLookup(params: {
	dealId: string;
	touchId: string;
	messenger: string;
}): Promise<void> {
	if (!db) return;
	await db.insert(adSearchQueryLookups).values(params).onConflictDoNothing();
}

/** Сделки, по которым запрос ещё не найден, — от старых кликов к новым. */
export async function listPendingAdSearchQueryLookups(
	limit = 200,
): Promise<PendingAdSearchQueryLookup[]> {
	if (!db) return [];
	return db
		.select({
			dealId: adSearchQueryLookups.dealId,
			messenger: adSearchQueryLookups.messenger,
			attempts: adSearchQueryLookups.attempts,
			adGroupId: adTouches.adGroupId,
			adId: adTouches.adId,
			keywordId: adTouches.keywordId,
			clickedAt: adTouches.occurredAt,
		})
		.from(adSearchQueryLookups)
		.innerJoin(adTouches, eq(adTouches.id, adSearchQueryLookups.touchId))
		.where(eq(adSearchQueryLookups.status, "pending"))
		.orderBy(asc(adTouches.occurredAt))
		.limit(limit);
}

/** Итог поиска: запрос найден либо искать больше не нужно. */
export async function resolveAdSearchQueryLookup(
	dealId: string,
	result: { status: "found"; query: string } | { status: "not_found" },
): Promise<void> {
	if (!db) return;
	await db
		.update(adSearchQueryLookups)
		.set({
			status: result.status,
			query: result.status === "found" ? result.query : null,
			resolvedAt: sql`now()`,
		})
		.where(
			and(
				eq(adSearchQueryLookups.dealId, dealId),
				eq(adSearchQueryLookups.status, "pending"),
			),
		);
}

/** Отчёт ещё пуст — запрос попробуем найти следующим прогоном. */
export async function bumpAdSearchQueryLookupAttempt(
	dealId: string,
): Promise<void> {
	if (!db) return;
	await db
		.update(adSearchQueryLookups)
		.set({ attempts: sql`${adSearchQueryLookups.attempts} + 1` })
		.where(eq(adSearchQueryLookups.dealId, dealId));
}
