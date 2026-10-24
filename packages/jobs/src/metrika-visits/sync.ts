import { fetchSearchQueryReport, matchSearchQuery } from "@psi-opora/bot-core";
import {
	getYandexMetrikaSettings,
	listDealVisitorsForVisitSummary,
	markDealVisitsSummarized,
} from "@psi-opora/db/queries";
import { adDealFields, describeAdClick, isNetworkClick } from "./ad-click";
import { createLogsApi } from "./logs-api";
import {
	type AdVisit,
	lastAdVisit,
	type SiteVisit,
	summarizeVisits,
	toSiteVisit,
	VISITS_LOOKBACK_DAYS,
	visitsBeforeDeal,
} from "./summary";

const DAY_MS = 24 * 60 * 60 * 1000;
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
/** Сделки старше этого срока не догоняем — сводка нужна, пока сделка в работе. */
const MAX_DEAL_AGE_DAYS = 14;
/**
 * С этого часа (МСК) статистика за вчера полная и в Logs API, и в отчёте
 * Директа по поисковым запросам; до него обрабатываем только позавчерашние
 * и более ранние сделки.
 */
const DATA_READY_HOUR_MSK = 8;

/** Минимум от BitrixApi: вызов REST-метода портала. */
export interface BitrixCaller {
	call(method: string, params: Record<string, unknown>): Promise<unknown>;
}

type LogsApi = ReturnType<typeof createLogsApi>;
type SearchQueryReport = typeof fetchSearchQueryReport;

export interface VisitSummariesResult {
	[key: string]: number | boolean;
	skipped: boolean;
	deals: number;
	done: number;
	noVisits: number;
	failed: number;
	visitRows: number;
	adClicks: number;
	searchQueries: number;
	pendingSearchQueries: number;
}

/** Дата по Москве (YYYY-MM-DD). */
function mskDate(time: number): string {
	return new Date(time + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

/** Начало текущих суток по Москве. */
function mskDayStart(now: Date): number {
	return Date.parse(`${mskDate(now.getTime())}T00:00:00Z`) - MSK_OFFSET_MS;
}

/** Значения по ключам → поля Bitrix по кодам из настроек; без кода не пишем. */
function toBitrixFields(
	values: Partial<Record<string, string>>,
	codes: Partial<Record<string, string>>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(values).flatMap(([key, value]) => {
			const code = codes[key];
			return code && value !== undefined ? [[code, value]] : [];
		}),
	);
}

function searchLookup(visit: AdVisit) {
	return {
		adGroupId: visit.adClick.groupId ?? null,
		adId: visit.adClick.adId ?? null,
		keywordId: visit.adClick.keywordId ?? null,
		clickedAt: visit.startedAt,
	};
}

/** Поисковые запросы по кликам с поиска; сбой Директа не мешает остальному. */
async function loadSearchQueryRows(
	clicks: Array<ReturnType<typeof searchLookup>>,
	report: SearchQueryReport,
) {
	if (clicks.length === 0) return [];
	try {
		return (await report(clicks)) ?? [];
	} catch (err) {
		console.warn(
			`[metrika-visits] не удалось получить поисковые запросы Директа: ${(err as Error).message}`,
		);
		return [];
	}
}

/**
 * Дописывает в сделки всё, что Яндекс знает о пути клиента до заявки, по
 * ClientID сделки, без скрипта касаний на сайте:
 * - реклама — последний визит с клика по Директу (Logs API): кампания,
 *   группа, объявление, город, позиция (из адреса входа), страница перехода
 *   и поисковый запрос из отчёта Директа — в рекламные поля сделки;
 * - визиты — число, первый визит и источник, устройство, страницы, время,
 *   цели — в поля визитов; подробно всё — в таймлайн.
 * Коды полей — /settings/metrika. Logs API не отдаёт текущий день, поэтому
 * сводка записывается на следующий день после создания, один раз, а поиск
 * запроса повторяется до 14 дней после создания сделки. Фильтра
 * по ClientID у Logs API нет: выгружается весь счётчик за окно визитов и
 * сопоставляется со сделками здесь, без сохранения чужих визитов.
 */
export async function syncDealVisitSummaries(
	bitrix: BitrixCaller,
	now: Date = new Date(),
	deps: {
		logsApi?: (counterId: string, token: string) => LogsApi;
		searchQueryReport?: SearchQueryReport;
	} = {},
): Promise<VisitSummariesResult> {
	const result: VisitSummariesResult = {
		skipped: false,
		deals: 0,
		done: 0,
		noVisits: 0,
		failed: 0,
		visitRows: 0,
		adClicks: 0,
		searchQueries: 0,
		pendingSearchQueries: 0,
	};
	const settings = await getYandexMetrikaSettings();
	if (!settings?.counterId || !settings.oauthToken) {
		return { ...result, skipped: true };
	}

	const todayStart = mskDayStart(now);
	const until =
		now.getTime() >= todayStart + DATA_READY_HOUR_MSK * 60 * 60 * 1000
			? todayStart
			: todayStart - DAY_MS;
	const deals = await listDealVisitorsForVisitSummary(
		new Date(todayStart - MAX_DEAL_AGE_DAYS * DAY_MS),
		new Date(until),
	);
	result.deals = deals.length;
	const oldest = deals[0];
	if (!oldest) return result;

	const api = (deps.logsApi ?? createLogsApi)(
		settings.counterId,
		settings.oauthToken,
	);
	const [rows, goalNames] = await Promise.all([
		api.visits(
			mskDate(oldest.createdAt.getTime() - VISITS_LOOKBACK_DAYS * DAY_MS),
			mskDate(todayStart - 1),
		),
		api.goalNames().catch((err: Error) => {
			console.warn(
				`[metrika-visits] не удалось получить названия целей: ${err.message}`,
			);
			return new Map<string, string>();
		}),
	]);
	result.visitRows = rows.length;

	const wanted = new Set(deals.map((deal) => deal.clientId));
	const visitsByClient = new Map<string, SiteVisit[]>();
	for (const row of rows) {
		if (!wanted.has(row.clientID ?? "")) continue;
		const visit = toSiteVisit(row);
		if (!visit) continue;
		visitsByClient.set(visit.clientId, [
			...(visitsByClient.get(visit.clientId) ?? []),
			visit,
		]);
	}

	const prepared = deals.map((deal) => {
		const visits = visitsBeforeDeal(
			visitsByClient.get(deal.clientId) ?? [],
			deal.createdAt,
		);
		const adVisit = lastAdVisit(visits);
		return { deal, visits, adVisit };
	});
	const searchClicks = prepared.flatMap(({ adVisit }) =>
		adVisit?.adClick.groupId && !isNetworkClick(adVisit.adClick)
			? [searchLookup(adVisit)]
			: [],
	);
	const searchRows = await loadSearchQueryRows(
		searchClicks,
		deps.searchQueryReport ?? fetchSearchQueryReport,
	);

	const adCodes = settings.bitrixAdDealFields ?? {};
	const visitCodes = settings.bitrixVisitDealFields ?? {};
	for (const { deal, visits, adVisit } of prepared) {
		try {
			const query =
				adVisit?.adClick.groupId && !isNetworkClick(adVisit.adClick)
					? matchSearchQuery(searchLookup(adVisit), searchRows)
					: undefined;
			const pendingSearchQuery = Boolean(
				adVisit?.adClick.groupId && !isNetworkClick(adVisit.adClick) && !query,
			);
			if (deal.visitsSummaryStatus === "pending_search_query") {
				if (!query) {
					result.pendingSearchQueries++;
					continue;
				}
				await writeSummary(
					bitrix,
					deal.dealId,
					toBitrixFields({ searchQuery: query }, adCodes),
					`Поисковый запрос (отчёт Директа): ${query}`,
				);
				await markDealVisitsSummarized(deal.dealId, "done");
				result.searchQueries++;
				result.done++;
				continue;
			}
			const summary = summarizeVisits(visits, goalNames);
			if (!summary) {
				await markDealVisitsSummarized(deal.dealId, "no_visits");
				result.noVisits++;
				continue;
			}
			const adLines: string[] = [];
			let adValues: Partial<Record<string, string>> = {};
			if (adVisit) {
				result.adClicks++;
				if (query) result.searchQueries++;
				adValues = {
					...Object.fromEntries(Object.keys(adCodes).map((key) => [key, ""])),
					...adDealFields(adVisit.adClick, adVisit.city),
					searchQuery: query ?? "",
				};
				adLines.push(
					`Реклама (последний клик по Директу перед заявкой): ${describeAdClick(adVisit.adClick)}`,
					...(query ? [`Поисковый запрос (отчёт Директа): ${query}`] : []),
					"",
				);
			}
			const fields = {
				...toBitrixFields(summary.fields, visitCodes),
				...toBitrixFields(adValues, adCodes),
			};
			await writeSummary(
				bitrix,
				deal.dealId,
				fields,
				[...adLines, summary.timelineComment].join("\n"),
			);
			await markDealVisitsSummarized(
				deal.dealId,
				pendingSearchQuery ? "pending_search_query" : "done",
			);
			if (pendingSearchQuery) result.pendingSearchQueries++;
			else result.done++;
		} catch (err) {
			result.failed++;
			console.error(
				`[metrika-visits] не удалось записать визиты в сделку ${deal.dealId}: ${(err as Error).message}`,
			);
		}
	}
	return result;
}

async function writeSummary(
	bitrix: BitrixCaller,
	dealId: string,
	fields: Record<string, string>,
	timelineComment: string,
): Promise<void> {
	if (Object.keys(fields).length > 0) {
		await bitrix.call("crm.deal.update", { id: dealId, fields });
	}
	await bitrix.call("crm.timeline.comment.add", {
		fields: {
			ENTITY_ID: Number(dealId),
			ENTITY_TYPE: "deal",
			COMMENT: timelineComment,
		},
	});
}
