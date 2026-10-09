import {
	type AnyColumn,
	and,
	desc,
	eq,
	gte,
	inArray,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { db } from "../client";
import { adEntities, adTouches, dealTouches } from "../schema/ad-touches";

export type AdTouch = typeof adTouches.$inferSelect;
export type NewAdTouch = typeof adTouches.$inferInsert;
export type AdEntity = typeof adEntities.$inferSelect;
export type NewAdEntity = typeof adEntities.$inferInsert;
export type AdEntityKind = "campaign" | "group" | "ad" | "keyword";
export type DealTouchRole = "first" | "middle" | "last" | "first_last";

/** Повторный заход с теми же метками в пределах окна — тот же визит (перезагрузка страницы). */
const DUPLICATE_WINDOW_MS = 30 * 60 * 1000;

/** Совпадение хотя бы по одному идентификатору визита; без обоих — ничего не ищем. */
function clientMatch(ids: {
	ymClientId?: string | null;
	yclid?: string | null;
}): SQL | undefined {
	const conditions: SQL[] = [];
	if (ids.ymClientId) conditions.push(eq(adTouches.ymClientId, ids.ymClientId));
	if (ids.yclid) conditions.push(eq(adTouches.yclid, ids.yclid));
	return conditions.length ? or(...conditions) : undefined;
}

function isNotDistinct(column: AnyColumn, value: string | null | undefined) {
	return sql`${column} is not distinct from ${value ?? null}`;
}

/**
 * Сохраняет касание, если это не повтор предыдущего: тот же клиент с теми же
 * метками за последние 30 минут (F5, возврат на страницу) касанием не
 * считается — иначе цепочка раздувалась бы дублями одного визита.
 */
export async function insertAdTouch(
	touch: NewAdTouch,
): Promise<{ inserted: boolean }> {
	if (!db) return { inserted: false };
	const match = clientMatch(touch);
	if (match) {
		const since = new Date(
			(touch.occurredAt?.getTime() ?? Date.now()) - DUPLICATE_WINDOW_MS,
		);
		const duplicate = await db
			.select({ id: adTouches.id })
			.from(adTouches)
			.where(
				and(
					match,
					gte(adTouches.occurredAt, since),
					isNotDistinct(adTouches.yclid, touch.yclid),
					isNotDistinct(adTouches.utmSource, touch.utmSource),
					isNotDistinct(adTouches.utmMedium, touch.utmMedium),
					isNotDistinct(adTouches.utmCampaign, touch.utmCampaign),
					isNotDistinct(adTouches.utmContent, touch.utmContent),
					isNotDistinct(adTouches.utmTerm, touch.utmTerm),
					isNotDistinct(adTouches.adId, touch.adId),
				),
			)
			.limit(1);
		if (duplicate.length > 0) return { inserted: false };
	}
	await db.insert(adTouches).values(touch).onConflictDoNothing();
	return { inserted: true };
}

/**
 * Касания клиента за окно `since`, от старых к новым: ищем и по ClientID
 * Метрики, и по yclid — одно может не захватиться (блокировщик, cookie), а
 * второе тот же визит всё равно свяжет. `limit` — последние N касаний.
 */
export async function listAdTouchesForClient(params: {
	ymClientId?: string | null;
	yclid?: string | null;
	since: Date;
	limit?: number;
}): Promise<AdTouch[]> {
	if (!db) return [];
	const match = clientMatch(params);
	if (!match) return [];
	const rows = await db
		.select()
		.from(adTouches)
		.where(and(match, gte(adTouches.occurredAt, params.since)))
		.orderBy(desc(adTouches.occurredAt))
		.limit(params.limit ?? 20);
	return rows.reverse();
}

/** Ссылки на сущности кабинета из свежих касаний — для крона, догружающего названия. */
export async function listAdTouchEntityRefsSince(
	since: Date,
): Promise<
	Pick<AdTouch, "adCampaignId" | "adGroupId" | "adId" | "keywordId">[]
> {
	if (!db) return [];
	return db
		.selectDistinct({
			adCampaignId: adTouches.adCampaignId,
			adGroupId: adTouches.adGroupId,
			adId: adTouches.adId,
			keywordId: adTouches.keywordId,
		})
		.from(adTouches)
		.where(gte(adTouches.occurredAt, since));
}

export async function getAdEntities(
	platform: string,
	externalIds: string[],
): Promise<AdEntity[]> {
	if (!db || externalIds.length === 0) return [];
	return db
		.select()
		.from(adEntities)
		.where(
			and(
				eq(adEntities.platform, platform),
				inArray(adEntities.externalId, externalIds),
			),
		);
}

export async function upsertAdEntities(rows: NewAdEntity[]): Promise<void> {
	if (!db || rows.length === 0) return;
	await db
		.insert(adEntities)
		.values(rows)
		.onConflictDoUpdate({
			target: [adEntities.platform, adEntities.kind, adEntities.externalId],
			set: { name: sql`excluded.name`, updatedAt: sql`now()` },
		});
}

export async function insertDealTouches(
	dealId: string,
	touches: Array<{ touchId: string; role: DealTouchRole }>,
): Promise<void> {
	if (!db || touches.length === 0) return;
	await db
		.insert(dealTouches)
		.values(touches.map((t) => ({ dealId, touchId: t.touchId, role: t.role })))
		.onConflictDoNothing();
}

export async function listDealTouchIds(dealId: string): Promise<string[]> {
	if (!db) return [];
	const rows = await db
		.select({ touchId: dealTouches.touchId })
		.from(dealTouches)
		.where(eq(dealTouches.dealId, dealId));
	return rows.map((r) => r.touchId);
}
