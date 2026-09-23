import {
	and,
	asc,
	desc,
	eq,
	gte,
	inArray,
	isNull,
	lte,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "../client";
import { dealStageHistory } from "../schema/deal-stage-history";
import { deals } from "../schema/deals";

export type DealRow = typeof deals.$inferSelect;
export type NewDeal = typeof deals.$inferInsert;

export type DealStatus = "won" | "lost" | "in_progress";

/** Marker value for "not specified" failReasonId in filters and facets. */
export const FAIL_REASON_NOT_SPECIFIED = "__NOT_SPECIFIED__";

// ── Sync (бэкафилл, периодическая сверка, вебхуки) ──────────────────────────

/**
 * Батч-апсерт по id — используется бэкафиллом и периодической сверкой.
 * pageUrl/contactId могут отсутствовать в конкретном raw-payload (see
 * normalizeSyncDeal) — тогда конфликтующую строку в БД не трогаем вместо
 * того, чтобы затереть её значение NULL из-за отсутствия поля в ответе
 * Bitrix, отсюда 4 батча на все комбинации "поле есть/нет".
 */
export async function upsertDeals(rows: NewDeal[]): Promise<void> {
	if (!db || rows.length === 0) return;
	const batches = [
		{ updatePageUrl: true, updateContactId: true },
		{ updatePageUrl: true, updateContactId: false },
		{ updatePageUrl: false, updateContactId: true },
		{ updatePageUrl: false, updateContactId: false },
	].map((flags) => ({
		...flags,
		rows: rows.filter(
			(row) =>
				(row.pageUrl !== undefined) === flags.updatePageUrl &&
				(row.contactId !== undefined) === flags.updateContactId,
		),
	}));

	for (const batch of batches) {
		if (batch.rows.length === 0) continue;
		await db
			.insert(deals)
			.values(batch.rows)
			.onConflictDoUpdate({
				target: deals.id,
				setWhere: sql`excluded.date_modify >= ${deals.dateModify}`,
				set: {
					title: sql`excluded.title`,
					stageId: sql`excluded.stage_id`,
					categoryId: sql`excluded.category_id`,
					status: sql`excluded.status`,
					opportunity: sql`excluded.opportunity`,
					currency: sql`excluded.currency`,
					sourceId: sql`excluded.source_id`,
					...(batch.updateContactId
						? { contactId: sql`excluded.contact_id` }
						: {}),
					failReasonId: sql`excluded.fail_reason_id`,
					...(batch.updatePageUrl ? { pageUrl: sql`excluded.page_url` } : {}),
					utmSource: sql`excluded.utm_source`,
					utmMedium: sql`excluded.utm_medium`,
					utmCampaign: sql`excluded.utm_campaign`,
					utmContent: sql`excluded.utm_content`,
					utmTerm: sql`excluded.utm_term`,
					dateCreate: sql`excluded.date_create`,
					closeDate: sql`excluded.close_date`,
					dateModify: sql`excluded.date_modify`,
					syncedAt: sql`now()`,
				},
			});
	}
}

/** Апсерт одной сделки — вебхук-обработчик (OnCrmDealAdd/Update). */
export async function upsertDeal(row: NewDeal): Promise<void> {
	await upsertDeals([row]);
}

const CONTACT_ID_UPDATE_BATCH_SIZE = 500;

/**
 * Точечное обновление contact_id на уже засинканных сделках —
 * scripts/backfill-deal-contacts.ts (разово после добавления колонки, чтобы
 * не ждать, пока каждая сделка сама изменится и пересинкуется). В отличие от
 * upsertDeals не требует остальных NOT NULL полей сделки — эти строки уже
 * существуют.
 */
export async function updateDealContactIds(
	pairs: Array<{ id: string; contactId: string | null }>,
): Promise<void> {
	if (!db || pairs.length === 0) return;
	for (let i = 0; i < pairs.length; i += CONTACT_ID_UPDATE_BATCH_SIZE) {
		const batch = pairs.slice(i, i + CONTACT_ID_UPDATE_BATCH_SIZE);
		const values = sql.join(
			batch.map((p) => sql`(${p.id}::text, ${p.contactId}::text)`),
			sql`, `,
		);
		await db.execute(sql`
			update deals set contact_id = v.contact_id
			from (values ${values}) as v(id, contact_id)
			where deals.id = v.id
		`);
	}
}

/** Удаление одной сделки — вебхук-обработчик (OnCrmDealDelete). */
export async function deleteDeal(id: string): Promise<void> {
	if (!db) return;
	await db.delete(deals).where(eq(deals.id, id));
}

/** Батч-удаление по id — периодическая сверка удалений (syncDeletedDeals). */
export async function deleteDeals(ids: string[]): Promise<void> {
	if (!db || ids.length === 0) return;
	await db.delete(deals).where(inArray(deals.id, ids));
}

/** Все id сделок зеркала — сверяются с полным списком id из Bitrix (syncDeletedDeals). */
export async function getAllDealIds(): Promise<string[]> {
	if (!db) return [];
	const rows = await db.select({ id: deals.id }).from(deals);
	return rows.map((row) => row.id);
}

/**
 * Курсор для инкрементальной сверки (deals-sync): последний известный
 * DATE_MODIFY среди уже синхронизированных сделок. null — таблица пуста,
 * нужен полный бэкафилл (scripts/backfill-deals.ts), а не инкремент.
 */
export async function getSyncWatermark(): Promise<Date | null> {
	if (!db) return null;
	const rows = await db
		.select({ max: sql<string | null>`max(${deals.dateModify})` })
		.from(deals);
	const value = rows[0]?.max;
	return value ? new Date(value) : null;
}

// ── Чтение: список сделок (замена fetchDeals/fetchOpenDeals) ───────────────

/** Одно значение — точное совпадение; массив — "любое из" (IN). */
type FilterValue<T extends string> = T | T[];

/**
 * "new" — сделка самая ранняя для своего contact_id за всю историю,
 * "repeat" — у контакта уже была более ранняя сделка (та же семантика и
 * порядок (date_create, id), что и в getClientAcquisitionByCampaign).
 * Сделки без contact_id не попадают ни в одну из групп.
 */
export type DealClientType = "new" | "repeat";

export interface ListDealsOptions {
	from?: Date;
	to?: Date;
	status?: FilterValue<DealStatus>;
	categoryId?: FilterValue<string>;
	stageId?: FilterValue<string>;
	sourceId?: FilterValue<string>;
	failReasonId?: FilterValue<string>;
	utmSource?: FilterValue<string>;
	utmMedium?: FilterValue<string>;
	utmCampaign?: FilterValue<string>;
	clientType?: DealClientType;
	search?: string;
	/**
	 * Сделки, у которых был переход на stageId (в рамках categoryId на момент
	 * перехода) с датой входа между from/to — источник: packages/db, таблица
	 * deal_stage_history (см. apps/dashboard/src/lib/analytics/deal-stage-history.ts).
	 * Независимый фильтр от categoryId/stageId выше (те — про ТЕКУЩУЮ стадию
	 * сделки): сделка может сейчас быть на другом этапе или в другой воронке.
	 */
	reachedStage?: { stageId: string; categoryId: string; from: Date; to: Date };
	sort?: "title" | "status" | "opportunity" | "dateCreate";
	sortDir?: "asc" | "desc";
	limit?: number;
	offset?: number;
}

const LIST_SORT_COLUMN = {
	title: deals.title,
	status: deals.status,
	opportunity: deals.opportunity,
	dateCreate: deals.dateCreate,
} as const;

/** eq() для одного значения, inArray() для массива (пустой массив — без фильтра). */
function matchClause<T extends string>(
	column: AnyPgColumn,
	value: FilterValue<T> | undefined,
): SQL | undefined {
	if (value === undefined) return undefined;
	if (Array.isArray(value)) {
		return value.length > 0 ? inArray(column, value) : undefined;
	}
	return eq(column, value);
}

/**
 * Special match clause for failReasonId that translates FAIL_REASON_NOT_SPECIFIED to isNull.
 */
function matchFailReasonClause(
	value: FilterValue<string> | undefined,
): SQL | undefined {
	if (value === undefined) return undefined;
	if (Array.isArray(value)) {
		if (value.length === 0) return undefined;
		const hasNotSpecified = value.includes(FAIL_REASON_NOT_SPECIFIED);
		const actualIds = value.filter((v) => v !== FAIL_REASON_NOT_SPECIFIED);
		if (hasNotSpecified && actualIds.length > 0) {
			return or(
				isNull(deals.failReasonId),
				inArray(deals.failReasonId, actualIds),
			);
		}
		if (hasNotSpecified) {
			return isNull(deals.failReasonId);
		}
		return inArray(deals.failReasonId, actualIds);
	}
	if (value === FAIL_REASON_NOT_SPECIFIED) {
		return isNull(deals.failReasonId);
	}
	return eq(deals.failReasonId, value);
}

function dealsWhere(
	options: Pick<
		ListDealsOptions,
		| "from"
		| "to"
		| "status"
		| "categoryId"
		| "stageId"
		| "sourceId"
		| "failReasonId"
		| "utmSource"
		| "utmMedium"
		| "utmCampaign"
		| "search"
		| "reachedStage"
	>,
): SQL | undefined {
	const clauses: SQL[] = [];
	// gte/lte (не sql``-интерполяция) — postgres.js иначе не сериализует Date
	// как параметр запроса ("Received an instance of Date" вместо строки).
	if (options.from) clauses.push(gte(deals.dateCreate, options.from));
	if (options.to) clauses.push(lte(deals.dateCreate, options.to));
	const status = matchClause(deals.status, options.status);
	if (status) clauses.push(status);
	const categoryId = matchClause(deals.categoryId, options.categoryId);
	if (categoryId) clauses.push(categoryId);
	const stageId = matchClause(deals.stageId, options.stageId);
	if (stageId) clauses.push(stageId);
	const sourceId = matchClause(deals.sourceId, options.sourceId);
	if (sourceId) clauses.push(sourceId);
	const failReasonId = matchFailReasonClause(options.failReasonId);
	if (failReasonId) clauses.push(failReasonId);
	const utmSource = matchClause(deals.utmSource, options.utmSource);
	if (utmSource) clauses.push(utmSource);
	const utmMedium = matchClause(deals.utmMedium, options.utmMedium);
	if (utmMedium) clauses.push(utmMedium);
	const utmCampaign = matchClause(deals.utmCampaign, options.utmCampaign);
	if (utmCampaign) clauses.push(utmCampaign);
	if (options.clientType) {
		const earlierDeal = sql`exists (
      select 1 from ${deals} as earlier
      where earlier.contact_id = ${deals.contactId}
        and (earlier.date_create, earlier.id) < (${deals.dateCreate}, ${deals.id})
    )`;
		clauses.push(sql`${deals.contactId} is not null`);
		clauses.push(
			options.clientType === "new" ? sql`not ${earlierDeal}` : earlierDeal,
		);
	}
	if (options.search?.trim()) {
		const term = `%${options.search.trim()}%`;
		clauses.push(sql`(
      ${deals.title} ilike ${term}
      or ${deals.utmSource} ilike ${term}
      or ${deals.utmMedium} ilike ${term}
      or ${deals.utmCampaign} ilike ${term}
      or ${deals.utmContent} ilike ${term}
      or ${deals.utmTerm} ilike ${term}
    )`);
	}
	if (options.reachedStage) {
		const { stageId, categoryId, from, to } = options.reachedStage;
		// from/to как ISO-строки, не Date, — та же причина, что и у gte/lte выше:
		// postgres.js не сериализует Date внутри sql``-интерполяции.
		clauses.push(sql`${deals.id} in (
      select ${dealStageHistory.dealId} from ${dealStageHistory}
      where ${dealStageHistory.stageId} = ${stageId}
        and ${dealStageHistory.categoryId} = ${categoryId}
        and ${dealStageHistory.enteredAt} >= ${from.toISOString()}
        and ${dealStageHistory.enteredAt} <= ${to.toISOString()}
    )`);
	}
	return clauses.length > 0 ? and(...clauses) : undefined;
}

async function selectDeals(
	where: SQL | undefined,
	options: Pick<ListDealsOptions, "sort" | "sortDir" | "limit" | "offset">,
): Promise<{ rows: DealRow[]; total: number }> {
	if (!db) return { rows: [], total: 0 };
	const sortColumn = LIST_SORT_COLUMN[options.sort ?? "dateCreate"];
	const order = options.sortDir === "asc" ? asc(sortColumn) : desc(sortColumn);
	const limit = options.limit ?? 50;
	const offset = options.offset ?? 0;

	const [rows, totalRows] = await Promise.all([
		db
			.select()
			.from(deals)
			.where(where)
			.orderBy(order)
			.limit(limit)
			.offset(offset),
		db.select({ count: sql<number>`count(*)::int` }).from(deals).where(where),
	]);
	return { rows, total: totalRows[0]?.count ?? 0 };
}

/** Список сделок с серверной фильтрацией/сортировкой/пагинацией. */
export async function listDeals(
	options: ListDealsOptions = {},
): Promise<{ rows: DealRow[]; total: number }> {
	return selectDeals(dealsWhere(options), options);
}

// ── Чтение: агрегация по разрезу (замена groupByUtmX/bucketBy+computeGroupStats) ─

export type DealGroupDimension =
	| "utmSource"
	| "utmMedium"
	| "utmCampaign"
	| "utmContent"
	| "utmTerm"
	| "source"
	| "category"
	| "stage"
	| "failReason"
	| "day"
	| "week"
	| "month";

export const DEAL_GROUP_DIMENSIONS: DealGroupDimension[] = [
	"utmSource",
	"utmMedium",
	"utmCampaign",
	"utmContent",
	"utmTerm",
	"source",
	"category",
	"stage",
	"failReason",
	"day",
	"week",
	"month",
];

export interface DealGroupStats {
	key: string;
	deals: number;
	/** Сколько сделок группы имеют заполненное поле "Сумма" (opportunity > 0). */
	dealsWithAmount: number;
	won: number;
	lost: number;
	inProgress: number;
	opportunitySum: number;
	wonSum: number;
	inProgressSum: number;
	conversionRate: number;
}

const NOT_SPECIFIED = "(не указано)";

/**
 * Ключ группы в SQL — для utmCampaign комбинируем utm_source+utm_campaign
 * через chr(31) (Unit Separator): нулевой байт (как раньше в JS-версии,
 * lib/analytics/aggregate.ts) здесь не подходит — Postgres отклоняет его
 * внутри текстового значения ("null character not permitted"). Для day/week/month — усечение даты. Подписи
 * (label) достраиваются в API-роуте поверх key — так эта функция не зависит
 * от справочников Bitrix (имена источников/стадий/воронок).
 */
function dimensionKeyExpr(dimension: DealGroupDimension): SQL<string> {
	switch (dimension) {
		case "utmSource":
			return sql<string>`coalesce(${deals.utmSource}, ${NOT_SPECIFIED})`;
		case "utmMedium":
			return sql<string>`coalesce(${deals.utmMedium}, ${NOT_SPECIFIED})`;
		case "utmContent":
			return sql<string>`coalesce(${deals.utmContent}, ${NOT_SPECIFIED})`;
		case "utmTerm":
			return sql<string>`coalesce(${deals.utmTerm}, ${NOT_SPECIFIED})`;
		case "utmCampaign":
			return sql<string>`coalesce(${deals.utmSource}, '') || chr(31) || coalesce(${deals.utmCampaign}, '')`;
		case "source":
			return sql<string>`coalesce(${deals.sourceId}, ${NOT_SPECIFIED})`;
		case "category":
			return sql<string>`${deals.categoryId}`;
		case "stage":
			return sql<string>`${deals.stageId}`;
		case "failReason":
			return sql<string>`coalesce(${deals.failReasonId}, ${FAIL_REASON_NOT_SPECIFIED})`;
		case "day":
			return sql<string>`to_char(${deals.dateCreate}, 'YYYY-MM-DD')`;
		case "week":
			// date_trunc('week', ...) в Postgres начинается с понедельника — как weekStart() на клиенте.
			return sql<string>`to_char(date_trunc('week', ${deals.dateCreate}), 'YYYY-MM-DD')`;
		case "month":
			return sql<string>`to_char(${deals.dateCreate}, 'YYYY-MM')`;
	}
}

export interface GroupDealsOptions extends Omit<ListDealsOptions, "sort"> {
	sort?:
		| "key"
		| "deals"
		| "won"
		| "opportunitySum"
		| "wonSum"
		| "conversionRate";
}

const GROUP_SORT_EXPR: Record<NonNullable<GroupDealsOptions["sort"]>, SQL> = {
	key: sql`key`,
	deals: sql`deals`,
	won: sql`won`,
	opportunitySum: sql`opportunity_sum`,
	wonSum: sql`won_sum`,
	conversionRate: sql`conversion_rate`,
};

/** Группировка сделок по разрезу — прямая замена groupByUtmX + пагинация. */
export async function groupDealsBy(
	dimension: DealGroupDimension,
	options: GroupDealsOptions = {},
): Promise<{ rows: DealGroupStats[]; total: number }> {
	if (!db) return { rows: [], total: 0 };
	const where = dealsWhere(options);
	const keyExpr = dimensionKeyExpr(dimension);
	const limit = options.limit ?? 20;
	const offset = options.offset ?? 0;
	const sortExpr = GROUP_SORT_EXPR[options.sort ?? "deals"];
	const orderSql =
		options.sortDir === "asc" ? sql`${sortExpr} asc` : sql`${sortExpr} desc`;

	const grouped = db.$with("grouped").as(
		db
			.select({
				key: keyExpr.as("key"),
				deals: sql<number>`count(*)::int`.as("deals"),
				dealsWithAmount:
					sql<number>`count(*) filter (where ${deals.opportunity} > 0)::int`.as(
						"deals_with_amount",
					),
				won: sql<number>`count(*) filter (where ${deals.status} = 'won')::int`.as(
					"won",
				),
				lost: sql<number>`count(*) filter (where ${deals.status} = 'lost')::int`.as(
					"lost",
				),
				inProgress:
					sql<number>`count(*) filter (where ${deals.status} = 'in_progress')::int`.as(
						"in_progress",
					),
				opportunitySum:
					sql<number>`coalesce(sum(${deals.opportunity}), 0)::int`.as(
						"opportunity_sum",
					),
				wonSum:
					sql<number>`coalesce(sum(${deals.opportunity}) filter (where ${deals.status} = 'won'), 0)::int`.as(
						"won_sum",
					),
				inProgressSum:
					sql<number>`coalesce(sum(${deals.opportunity}) filter (where ${deals.status} = 'in_progress'), 0)::int`.as(
						"in_progress_sum",
					),
			})
			.from(deals)
			.where(where)
			// Группируем по алиасу "key" из select, а не повторной интерполяцией
			// keyExpr — иначе параметризованный литерал внутри coalesce(...) (NOT_SPECIFIED)
			// попадает в запрос дважды и путает нумерацию $-параметров postgres.js.
			.groupBy(sql`key`),
	);

	const [rows, totalRows] = await Promise.all([
		db
			.with(grouped)
			.select({
				key: grouped.key,
				deals: grouped.deals,
				dealsWithAmount: grouped.dealsWithAmount,
				won: grouped.won,
				lost: grouped.lost,
				inProgress: grouped.inProgress,
				opportunitySum: grouped.opportunitySum,
				wonSum: grouped.wonSum,
				inProgressSum: grouped.inProgressSum,
				conversionRate:
					sql<number>`case when ${grouped.won} + ${grouped.lost} > 0
          then ${grouped.won}::float / (${grouped.won} + ${grouped.lost}) else 0 end`.as(
						"conversion_rate",
					),
			})
			.from(grouped)
			.orderBy(orderSql)
			.limit(limit)
			.offset(offset),
		db
			.with(grouped)
			.select({ count: sql<number>`count(*)::int` })
			.from(grouped),
	]);
	return { rows, total: totalRows[0]?.count ?? 0 };
}

/**
 * Сделки одной группы разреза (клик по строке в отчёте → диалог со списком
 * сделок) — фильтр по тому же SQL-выражению ключа, что и groupDealsBy, без
 * отдельного параметра-фильтра под каждое измерение (составной ключ
 * utmCampaign, усечённая дата day/week/month и т.п. иначе было бы не выразить).
 */
export async function listDealsInGroup(
	dimension: DealGroupDimension,
	key: string,
	options: Pick<
		ListDealsOptions,
		| "from"
		| "to"
		| "status"
		| "categoryId"
		| "stageId"
		| "sourceId"
		| "failReasonId"
		| "utmSource"
		| "utmMedium"
		| "utmCampaign"
		| "clientType"
		| "search"
		| "sort"
		| "sortDir"
		| "limit"
		| "offset"
	> = {},
): Promise<{ rows: DealRow[]; total: number }> {
	const rangeWhere = dealsWhere(options);
	const keyWhere = sql`${dimensionKeyExpr(dimension)} = ${key}`;
	const where = rangeWhere ? and(rangeWhere, keyWhere) : keyWhere;
	return selectDeals(where, options);
}

// ── Чтение: новые/повторные клиенты по кампании ─────────────────────────────

export interface ClientAcquisitionRow {
	/** Тот же составной ключ utm_source+utm_campaign, что и dimension="utmCampaign" в groupDealsBy. */
	key: string;
	newClients: number;
	/** Сумма только первых сделок новых клиентов (не LTV) — считается только для выигранных. */
	newClientsRevenue: number;
	repeatClients: number;
	repeatRevenue: number;
}

/**
 * "Новый" клиент — тот, для чьего contact_id выбранная сделка является
 * самой ранней за всю историю (не только в пределах периода from/to);
 * "повторный" — у него уже была более ранняя сделка, независимо от её
 * статуса. Сделки без contact_id (ещё не досинканы или связка появилась
 * только с этой функциональностью) не участвуют ни в одной из групп.
 *
 * "первая сделка" считается по ВСЕЙ таблице deals (contactFirstDeal ниже не
 * фильтруется по датам) — иначе клиент, чья первая сделка была до начала
 * периода, ошибочно попал бы в "новые".
 */
export async function getClientAcquisitionByCampaign(range: {
	from: Date;
	to: Date;
}): Promise<ClientAcquisitionRow[]> {
	if (!db) return [];

	const contactFirstDeal = db.$with("contact_first_deal").as(
		db
			.select({
				id: deals.id,
				contactId: deals.contactId,
				utmSource: deals.utmSource,
				utmCampaign: deals.utmCampaign,
				dateCreate: deals.dateCreate,
				status: deals.status,
				opportunity: deals.opportunity,
				rn: sql<number>`row_number() over (
					partition by ${deals.contactId}
					order by ${deals.dateCreate} asc, ${deals.id} asc
				)`.as("rn"),
			})
			.from(deals)
			.where(sql`${deals.contactId} is not null`),
	);

	const newDeals = db.$with("new_deals").as(
		db
			.select({
				// Отдельное имя колонки (не "key") от repeatDeals ниже — иначе при
				// full join оба "key" неразличимы для Postgres ("column reference
				// is ambiguous"), даже если ссылаться на них через объект CTE.
				newKey:
					sql<string>`coalesce(${contactFirstDeal.utmSource}, '') || chr(31) || coalesce(${contactFirstDeal.utmCampaign}, '')`.as(
						"new_key",
					),
				newClients: sql<number>`count(*)::int`.as("new_clients"),
				newClientsRevenue:
					sql<number>`coalesce(sum(${contactFirstDeal.opportunity}) filter (where ${contactFirstDeal.status} = 'won'), 0)::int`.as(
						"new_clients_revenue",
					),
			})
			.from(contactFirstDeal)
			.where(
				and(
					eq(contactFirstDeal.rn, 1),
					gte(contactFirstDeal.dateCreate, range.from),
					lte(contactFirstDeal.dateCreate, range.to),
				),
			)
			.groupBy(sql`new_key`),
	);

	const repeatDeals = db.$with("repeat_deals").as(
		db
			.select({
				repeatKey:
					sql<string>`coalesce(${deals.utmSource}, '') || chr(31) || coalesce(${deals.utmCampaign}, '')`.as(
						"repeat_key",
					),
				repeatClients: sql<number>`count(distinct ${deals.contactId})::int`.as(
					"repeat_clients",
				),
				repeatRevenue:
					sql<number>`coalesce(sum(${deals.opportunity}) filter (where ${deals.status} = 'won'), 0)::int`.as(
						"repeat_revenue",
					),
			})
			.from(deals)
			.innerJoin(
				contactFirstDeal,
				and(
					eq(contactFirstDeal.contactId, deals.contactId),
					eq(contactFirstDeal.rn, 1),
				),
			)
			.where(
				and(
					sql`${deals.id} != ${contactFirstDeal.id}`,
					gte(deals.dateCreate, range.from),
					lte(deals.dateCreate, range.to),
				),
			)
			.groupBy(sql`repeat_key`),
	);

	return db
		.with(contactFirstDeal, newDeals, repeatDeals)
		.select({
			key: sql<string>`coalesce(${newDeals.newKey}, ${repeatDeals.repeatKey})`.as(
				"key",
			),
			newClients: sql<number>`coalesce(${newDeals.newClients}, 0)`,
			newClientsRevenue: sql<number>`coalesce(${newDeals.newClientsRevenue}, 0)`,
			repeatClients: sql<number>`coalesce(${repeatDeals.repeatClients}, 0)`,
			repeatRevenue: sql<number>`coalesce(${repeatDeals.repeatRevenue}, 0)`,
		})
		.from(newDeals)
		.fullJoin(repeatDeals, eq(newDeals.newKey, repeatDeals.repeatKey));
}

// ── Чтение: сводка и тренд (замена summarize/trendByDay) ────────────────────

export interface DealsSummary {
	totalDeals: number;
	wonDeals: number;
	lostDeals: number;
	inProgressDeals: number;
	opportunitySum: number;
	wonSum: number;
	inProgressSum: number;
	conversionRate: number;
	avgDealSize: number;
	avgCycleDays: number;
}

export async function getDealsSummary(
	options: Pick<
		ListDealsOptions,
		| "from"
		| "to"
		| "status"
		| "categoryId"
		| "stageId"
		| "sourceId"
		| "utmSource"
		| "utmMedium"
		| "utmCampaign"
	> = {},
): Promise<DealsSummary> {
	const empty: DealsSummary = {
		totalDeals: 0,
		wonDeals: 0,
		lostDeals: 0,
		inProgressDeals: 0,
		opportunitySum: 0,
		wonSum: 0,
		inProgressSum: 0,
		conversionRate: 0,
		avgDealSize: 0,
		avgCycleDays: 0,
	};
	if (!db) return empty;
	const where = dealsWhere(options);
	const rows = await db
		.select({
			totalDeals: sql<number>`count(*)::int`,
			wonDeals: sql<number>`count(*) filter (where ${deals.status} = 'won')::int`,
			lostDeals: sql<number>`count(*) filter (where ${deals.status} = 'lost')::int`,
			inProgressDeals: sql<number>`count(*) filter (where ${deals.status} = 'in_progress')::int`,
			opportunitySum: sql<number>`coalesce(sum(${deals.opportunity}), 0)::int`,
			wonSum: sql<number>`coalesce(sum(${deals.opportunity}) filter (where ${deals.status} = 'won'), 0)::int`,
			inProgressSum: sql<number>`coalesce(sum(${deals.opportunity}) filter (where ${deals.status} = 'in_progress'), 0)::int`,
			avgCycleDays: sql<number>`coalesce(avg(
        extract(epoch from (${deals.closeDate} - ${deals.dateCreate})) / 86400.0
      ) filter (where ${deals.status} = 'won' and ${deals.closeDate} is not null), 0)`,
		})
		.from(deals)
		.where(where);

	const r = rows[0];
	if (!r) return empty;
	const closed = r.wonDeals + r.lostDeals;
	return {
		totalDeals: r.totalDeals,
		wonDeals: r.wonDeals,
		lostDeals: r.lostDeals,
		inProgressDeals: r.inProgressDeals,
		opportunitySum: r.opportunitySum,
		wonSum: r.wonSum,
		inProgressSum: r.inProgressSum,
		conversionRate: closed > 0 ? r.wonDeals / closed : 0,
		avgDealSize: r.wonDeals > 0 ? r.wonSum / r.wonDeals : 0,
		avgCycleDays: r.avgCycleDays,
	};
}

export interface DealsTrendPoint {
	date: string;
	deals: number;
	won: number;
	opportunitySum: number;
}

export async function getDealsTrendByDay(
	options: Pick<
		ListDealsOptions,
		| "from"
		| "to"
		| "status"
		| "categoryId"
		| "stageId"
		| "sourceId"
		| "utmSource"
		| "utmMedium"
		| "utmCampaign"
	> = {},
): Promise<DealsTrendPoint[]> {
	if (!db) return [];
	const where = dealsWhere(options);
	const day = sql<string>`to_char(${deals.dateCreate}, 'YYYY-MM-DD')`;
	return db
		.select({
			date: day.as("date"),
			deals: sql<number>`count(*)::int`,
			won: sql<number>`count(*) filter (where ${deals.status} = 'won')::int`,
			opportunitySum: sql<number>`coalesce(sum(${deals.opportunity}), 0)::int`,
		})
		.from(deals)
		.where(where)
		.groupBy(day)
		.orderBy(asc(day));
}

// ── Чтение: фасеты для фильтров конструктора отчётов ────────────────────────

export interface FilterFacet {
	value: string;
	count: number;
}

export interface DealFilterFacets {
	status: FilterFacet[];
	categoryId: FilterFacet[];
	sourceId: FilterFacet[];
	failReasonId: FilterFacet[];
	utmSource: FilterFacet[];
	utmMedium: FilterFacet[];
	utmCampaign: FilterFacet[];
}

/**
 * Счётчики по значениям для фильтров конструктора отчётов (ReportBuilder) —
 * шесть простых GROUP BY параллельно, вместо прохода по всем сделкам периода
 * в браузере (lib/analytics/aggregate.ts — filterOptions). Подписи (имена
 * категорий/источников) достраиваются в API-роуте.
 */
export async function getFilterFacets(
	options: Pick<ListDealsOptions, "from" | "to"> = {},
): Promise<DealFilterFacets> {
	const empty: DealFilterFacets = {
		status: [],
		categoryId: [],
		sourceId: [],
		failReasonId: [],
		utmSource: [],
		utmMedium: [],
		utmCampaign: [],
	};
	if (!db) return empty;
	const where = dealsWhere(options);

	function facet(column: AnyPgColumn, fallback?: string) {
		const value = fallback
			? sql<string>`coalesce(${column}, ${fallback})`
			: sql<string>`${column}`;
		return (
			db
				.select({ value: value.as("value"), count: sql<number>`count(*)::int` })
				.from(deals)
				.where(where)
				// Группируем по алиасу "value", не по value повторно — та же причина,
				// что и в groupDealsBy (см. комментарий там).
				.groupBy(sql`value`)
				.orderBy(desc(sql`count(*)`))
		);
	}

	const [
		status,
		categoryId,
		sourceId,
		failReasonId,
		utmSource,
		utmMedium,
		utmCampaign,
	] = await Promise.all([
		facet(deals.status),
		facet(deals.categoryId),
		facet(deals.sourceId, NOT_SPECIFIED),
		facet(deals.failReasonId, FAIL_REASON_NOT_SPECIFIED),
		facet(deals.utmSource, NOT_SPECIFIED),
		facet(deals.utmMedium, NOT_SPECIFIED),
		facet(deals.utmCampaign, NOT_SPECIFIED),
	]);

	return {
		status,
		categoryId,
		sourceId,
		failReasonId,
		utmSource,
		utmMedium,
		utmCampaign,
	};
}
