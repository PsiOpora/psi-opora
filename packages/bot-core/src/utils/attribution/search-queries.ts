import {
	bumpAdSearchQueryLookupAttempt,
	getAdCredentials,
	getYandexMetrikaSettings,
	listPendingAdSearchQueryLookups,
	type PendingAdSearchQueryLookup,
	resolveAdSearchQueryLookup,
} from "@psi-opora/db/queries";
import { getYandexToken } from "../ads-stats";
import { type DirectReportRow, fetchDirectReport } from "../direct-reports";

/**
 * Поисковый запрос клика по объявлению. Макроса с запросом у Директа нет, а
 * Метрика не отдаёт поисковые фразы по выборке меньше 10 посетителей (то есть
 * по ClientID одного клиента). Поэтому запрос берётся из отчёта Директа по
 * поисковым запросам за день клика: строки той же группы, а если известны —
 * того же объявления и ключевой фразы, с кликами. Один запрос — почти наверняка
 * запрос клиента; несколько — пишем самые кликабельные как вероятные.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
/** Статистика за день считается полной к 06:00 МСК следующего дня. */
const READY_AFTER_DAY_END_MS = 6 * 60 * 60 * 1000;
/** Позже запрос в отчёте уже не появится — перестаём искать. */
const GIVE_UP_AFTER_DAY_END_MS = 3 * DAY_MS;
const MAX_CANDIDATES = 3;

const REPORT_FIELDS = [
	"Date",
	"AdGroupId",
	"AdId",
	"CriterionId",
	"Query",
	"Clicks",
] as const;

/** Минимум от BitrixApi: вызов REST-метода портала. */
export interface BitrixCaller {
	call(method: string, params: Record<string, unknown>): Promise<unknown>;
}

/** Дата клика по Москве (YYYY-MM-DD) — в этом часовом поясе Директ считает дни. */
export function mskDate(date: Date): string {
	return new Date(date.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

/** Конец московских суток клика (UTC-момент 00:00 МСК следующего дня). */
function mskDayEnd(date: Date): number {
	return Date.parse(`${mskDate(date)}T00:00:00Z`) - MSK_OFFSET_MS + DAY_MS;
}

/**
 * Уточнение по ключевой фразе — только если оно что-то оставляет: для
 * автотаргетинга и дополнительных фраз {phrase_id} может не совпасть с
 * CriterionId отчёта, и тогда достаточно группы и объявления.
 */
function narrowByKeyword(
	rows: DirectReportRow[],
	keywordId: string | null,
): DirectReportRow[] {
	if (!keywordId) return rows;
	const matched = rows.filter((row) => row.CriterionId === keywordId);
	return matched.length > 0 ? matched : rows;
}

/** Запрос клика из строк отчёта или undefined, если подходящих строк нет. */
export function matchSearchQuery(
	lookup: Pick<
		PendingAdSearchQueryLookup,
		"adGroupId" | "adId" | "keywordId" | "clickedAt"
	>,
	rows: DirectReportRow[],
): string | undefined {
	const date = mskDate(lookup.clickedAt);
	const matched = rows.filter(
		(row) =>
			row.Date === date &&
			row.AdGroupId === lookup.adGroupId &&
			(!lookup.adId || row.AdId === lookup.adId) &&
			Number(row.Clicks) > 0 &&
			Boolean(row.Query?.trim()),
	);
	const candidates = narrowByKeyword(matched, lookup.keywordId);
	if (candidates.length === 0) return undefined;

	const clicksByQuery = new Map<string, number>();
	for (const row of candidates) {
		const query = (row.Query ?? "").trim();
		clicksByQuery.set(
			query,
			(clicksByQuery.get(query) ?? 0) + Number(row.Clicks),
		);
	}
	const queries = [...clicksByQuery]
		.sort((a, b) => b[1] - a[1])
		.map(([query]) => query);
	if (queries.length === 1) return queries[0];
	const top = queries.slice(0, MAX_CANDIDATES).join(" / ");
	const rest = queries.length - MAX_CANDIDATES;
	return `вероятно: ${top}${rest > 0 ? ` и ещё ${rest}` : ""}`;
}

async function writeToDeal(
	bitrix: BitrixCaller,
	dealId: string,
	query: string,
	fieldCode: string | undefined,
): Promise<void> {
	if (fieldCode) {
		await bitrix.call("crm.deal.update", {
			id: dealId,
			fields: { [fieldCode]: query },
		});
	}
	await bitrix.call("crm.timeline.comment.add", {
		fields: {
			ENTITY_ID: Number(dealId),
			ENTITY_TYPE: "deal",
			COMMENT: `Поисковый запрос перед кликом по объявлению (отчёт Директа): ${query}`,
		},
	});
}

/**
 * Отчёт Директа по поисковым запросам с кликами за дни кликов по их группам —
 * одним запросом на все клики. null — учётные данные Директа не настроены.
 */
export async function fetchSearchQueryReport(
	clicks: Array<Pick<PendingAdSearchQueryLookup, "adGroupId" | "clickedAt">>,
): Promise<DirectReportRow[] | null> {
	const groupIds = [
		...new Set(clicks.flatMap((click) => click.adGroupId ?? [])),
	];
	if (groupIds.length === 0) return [];
	const creds = await getAdCredentials();
	if (
		!creds?.yandexClientId ||
		!creds.yandexClientSecret ||
		!creds.yandexRefreshToken
	) {
		return null;
	}
	const dates = clicks.map((click) => mskDate(click.clickedAt)).sort();
	const token = await getYandexToken(
		creds.yandexClientId,
		creds.yandexClientSecret,
		creds.yandexRefreshToken,
	);
	return fetchDirectReport({
		token,
		clientLogin: creds.yandexClientLogin ?? undefined,
		reportType: "SEARCH_QUERY_PERFORMANCE_REPORT",
		fieldNames: REPORT_FIELDS,
		dateFrom: dates[0] ?? "",
		dateTo: dates.at(-1) ?? "",
		filter: [
			{ Field: "AdGroupId", Operator: "IN", Values: groupIds },
			{ Field: "Clicks", Operator: "GREATER_THAN", Values: ["0"] },
		],
	});
}

export interface SearchQueriesResult {
	[key: string]: number | boolean;
	skipped: boolean;
	checked: number;
	found: number;
	notFound: number;
	waiting: number;
}

/**
 * Проходит очередь ad_search_query_lookups: для кликов, чей день уже
 * посчитан, строит один отчёт Директа по всем их группам и дописывает
 * найденный запрос в поле сделки (код поля — /settings/metrika) и в таймлайн.
 * Сбой Bitrix по одной сделке оставляет её в очереди до следующего прогона.
 */
export async function resolvePendingSearchQueries(
	bitrix: BitrixCaller,
	now: Date = new Date(),
): Promise<SearchQueriesResult> {
	const result: SearchQueriesResult = {
		skipped: false,
		checked: 0,
		found: 0,
		notFound: 0,
		waiting: 0,
	};
	const pending = await listPendingAdSearchQueryLookups();
	const ready = pending.filter(
		(lookup) =>
			lookup.adGroupId &&
			now.getTime() >= mskDayEnd(lookup.clickedAt) + READY_AFTER_DAY_END_MS,
	);
	result.waiting = pending.length - ready.length;
	if (ready.length === 0) return result;

	const rows = await fetchSearchQueryReport(ready);
	if (!rows) return { ...result, skipped: true };
	const settings = await getYandexMetrikaSettings();
	const fieldCode = settings?.bitrixAdDealFields?.searchQuery;

	for (const lookup of ready) {
		result.checked++;
		const query = matchSearchQuery(lookup, rows);
		if (query) {
			try {
				await writeToDeal(bitrix, lookup.dealId, query, fieldCode);
				await resolveAdSearchQueryLookup(lookup.dealId, {
					status: "found",
					query,
				});
				result.found++;
			} catch (err) {
				console.error(
					`[search-queries] не удалось записать запрос в сделку ${lookup.dealId}: ${(err as Error).message}`,
				);
			}
		} else if (
			now.getTime() >=
			mskDayEnd(lookup.clickedAt) + GIVE_UP_AFTER_DAY_END_MS
		) {
			await resolveAdSearchQueryLookup(lookup.dealId, { status: "not_found" });
			result.notFound++;
		} else {
			await bumpAdSearchQueryLookupAttempt(lookup.dealId);
		}
	}
	return result;
}
