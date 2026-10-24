import { and, asc, eq, isNotNull, ne, notExists, sql } from "drizzle-orm";
import { db } from "../client";
import { adSearchQueryLookups, adTouches } from "../schema/ad-touches";
import { yandexMetrikaDealVisitors } from "../schema/yandex-metrika";

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
	excludeMetrikaDeals = false,
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
		.where(
			and(
				eq(adSearchQueryLookups.status, "pending"),
				// При настроенной Метрике запрос сделок с ClientID пишет только
				// metrikaVisits — по выбранному визиту, а не по старому касанию.
				excludeMetrikaDeals
					? notExists(
							db
								.select({ id: yandexMetrikaDealVisitors.dealId })
								.from(yandexMetrikaDealVisitors)
								.where(
									and(
										eq(
											yandexMetrikaDealVisitors.dealId,
											adSearchQueryLookups.dealId,
										),
										isNotNull(yandexMetrikaDealVisitors.clientId),
										ne(yandexMetrikaDealVisitors.clientId, ""),
									),
								),
						)
					: undefined,
			),
		)
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
