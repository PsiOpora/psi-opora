import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { LogsVisitRow } from "./logs-api";

const CLIENT_ID = "163972457524306386";

let settings: Record<string, unknown> | null = null;
let deals: Array<{
	dealId: string;
	clientId: string;
	createdAt: Date;
	visitsSummaryStatus?: "pending_search_query" | "no_visits" | null;
	visitsSummarizedAt?: Date | null;
}> = [];
const listCalls: Array<{ since: Date; until: Date }> = [];
const marked: Array<[string, string]> = [];

mock.module("@psi-opora/db/queries", () => ({
	getYandexMetrikaSettings: () => Promise.resolve(settings),
	listDealVisitorsForVisitSummary: (since: Date, until: Date) => {
		listCalls.push({ since, until });
		return Promise.resolve(deals);
	},
	markDealVisitsSummarized: (dealId: string, status: string) => {
		marked.push([dealId, status]);
		return Promise.resolve();
	},
}));

// Сопоставление запроса проверено в bot-core (search-queries.test.ts); здесь —
// только что задача передаёт клик и пишет результат.
mock.module("@psi-opora/bot-core", () => ({
	fetchSearchQueryReport: () => Promise.resolve([]),
	matchSearchQuery: (
		lookup: { adGroupId: string | null },
		rows: Array<Record<string, string>>,
	) => rows.find((r) => r.AdGroupId === lookup.adGroupId)?.Query,
	formatClickPosition: (t: { adPosition: string | null }) =>
		t.adPosition ?? undefined,
}));

const { syncDealVisitSummaries } = await import("./sync");

function visitRow(overrides: Partial<LogsVisitRow> = {}): LogsVisitRow {
	return {
		visitID: "1001",
		clientID: CLIENT_ID,
		dateTime: "2026-10-08 11:40:00",
		startURL: "https://psi-opora.ru/anorexia/",
		pageViews: "3",
		visitDuration: "200",
		bounce: "0",
		regionCity: "Moscow",
		deviceCategory: "1",
		lastTrafficSource: "direct",
		goalsID: "[]",
		...overrides,
	};
}

// 10.10, 10:00 МСК — обрабатываются сделки, созданные до начала суток.
const NOW = new Date("2026-10-10T07:00:00Z");

const AD_VISIT: Partial<LogsVisitRow> = {
	visitID: "1002",
	dateTime: "2026-10-08 11:50:00",
	startURL: "https://psi-opora.ru/anorexia/?position=2&utm_source=yandex",
	regionCity: "Saint Petersburg",
	lastTrafficSource: "ad",
	lastAdvEngine: "ya_direct",
	lastDirectClickOrder: "708811857",
	lastDirectClickOrderName: "Анорексия — поиск",
	lastDirectBannerGroup: "5600000111",
	lastClickBannerGroupName: "Лечение анорексии",
	lastDirectClickBanner: "17000000123",
	lastDirectClickBannerName: "Помощь при анорексии",
	lastDirectPlatformType: "search",
};

describe("syncDealVisitSummaries", () => {
	const bitrixCalls: Array<{ method: string; params: unknown }> = [];
	// Сделка в Bitrix по crm.deal.get — нужна только для решения, переписывать
	// ли UTM; вызовы чтения не попадают в bitrixCalls (там только записи).
	let dealInBitrix: unknown = { UTM_CAMPAIGN: "search_anorexia_708811857" };
	const dealGets: unknown[] = [];
	const bitrix = {
		call: (method: string, params: Record<string, unknown>) => {
			if (method === "crm.deal.get") {
				dealGets.push(params);
				return Promise.resolve(dealInBitrix);
			}
			bitrixCalls.push({ method, params });
			return Promise.resolve(true);
		},
	};
	let rows: LogsVisitRow[] = [];
	const visitsCalls: Array<[string, string]> = [];
	const logsApi = () => ({
		visits: (date1: string, date2: string) => {
			visitsCalls.push([date1, date2]);
			return Promise.resolve(rows);
		},
		goalNames: () => Promise.resolve(new Map<string, string>()),
	});

	beforeEach(() => {
		settings = {
			counterId: "12345678",
			oauthToken: "token",
			bitrixVisitDealFields: {
				visitCount: "UF_CRM_VISITS",
				city: "UF_CRM_CITY",
			},
		};
		deals = [
			{
				dealId: "501",
				clientId: CLIENT_ID,
				createdAt: new Date("2026-10-08T09:00:00Z"),
			},
			{
				dealId: "502",
				clientId: "999999999999999999",
				createdAt: new Date("2026-10-09T09:00:00Z"),
			},
		];
		rows = [
			visitRow(),
			// чужой посетитель — не используется и не сохраняется
			visitRow({ visitID: "5", clientID: "111111111111111111" }),
		];
		listCalls.length = 0;
		marked.length = 0;
		bitrixCalls.length = 0;
		dealGets.length = 0;
		dealInBitrix = { UTM_CAMPAIGN: "search_anorexia_708811857" };
		visitsCalls.length = 0;
	});

	test("пишет сводку в настроенные поля и таймлайн, без визитов — no_visits", async () => {
		const result = await syncDealVisitSummaries(bitrix, NOW, { logsApi });
		expect(result).toMatchObject({ deals: 2, done: 1, noVisits: 1, failed: 0 });
		// окно сделок: до начала сегодняшних суток по Москве, не старше 14 дней
		expect(listCalls[0]?.until).toEqual(new Date("2026-10-09T21:00:00Z"));
		expect(listCalls[0]?.since).toEqual(new Date("2026-09-25T21:00:00Z"));
		// визиты — за 30 дней до самой старой сделки и по вчера
		expect(visitsCalls).toEqual([["2026-09-08", "2026-10-09"]]);
		expect(bitrixCalls[0]).toEqual({
			method: "crm.deal.update",
			params: {
				id: "501",
				fields: { UF_CRM_VISITS: "1", UF_CRM_CITY: "Moscow" },
			},
		});
		expect(bitrixCalls[1]?.method).toBe("crm.timeline.comment.add");
		expect(marked).toEqual([
			["501", "done"],
			["502", "no_visits"],
		]);
	});

	test("последний клик по Директу и поисковый запрос — в рекламные поля", async () => {
		settings = {
			...settings,
			bitrixAdDealFields: {
				campaign: "UF_CRM_YA_AD_CAMPAIGN",
				searchQuery: "UF_CRM_QUERY",
				region: "UF_CRM_YA_AD_REGION",
				clickPosition: "UF_CRM_POS",
				landingPage: "UF_CRM_PAGE",
			},
		};
		rows = [visitRow(), visitRow(AD_VISIT)];
		const reportCalls: unknown[] = [];
		const result = await syncDealVisitSummaries(bitrix, NOW, {
			logsApi,
			searchQueryReport: (clicks) => {
				reportCalls.push(clicks);
				return Promise.resolve([
					{ AdGroupId: "5600000111", Query: "лечение анорексии спб" },
				]);
			},
		});
		expect(result).toMatchObject({ adClicks: 1, searchQueries: 1 });
		expect(reportCalls).toEqual([
			[
				{
					adGroupId: "5600000111",
					adId: "17000000123",
					keywordId: null,
					clickedAt: new Date("2026-10-08T08:50:00Z"),
				},
			],
		]);
		expect(bitrixCalls[0]?.params).toEqual({
			id: "501",
			fields: {
				UF_CRM_VISITS: "2",
				UF_CRM_CITY: "Saint Petersburg",
				UF_CRM_YA_AD_CAMPAIGN: "Анорексия — поиск",
				UF_CRM_QUERY: "лечение анорексии спб",
				UF_CRM_YA_AD_REGION: "Saint Petersburg",
				UF_CRM_POS: "2",
				UF_CRM_PAGE: "https://psi-opora.ru/anorexia/",
			},
		});
		const params = bitrixCalls[1]?.params as
			| { fields: { COMMENT: string } }
			| undefined;
		const comment = params?.fields.COMMENT;
		expect(comment).toStartWith(
			"Реклама (последний клик по Директу перед заявкой): РК «Анорексия — поиск»",
		);
		expect(comment).toContain(
			"Поисковый запрос (отчёт Директа): лечение анорексии спб",
		);
	});

	test("бот не знал кампанию — UTM сделки заполняются по клику из Директа", async () => {
		dealInBitrix = {
			UTM_SOURCE: "max",
			UTM_MEDIUM: "max_bot",
			UTM_CAMPAIGN: "",
		};
		rows = [
			visitRow({
				...AD_VISIT,
				lastUTMCampaign: "search_anorexia_708811857",
				lastUTMContent: "17000000123_premium_mobile",
				lastUTMTerm: "лечение анорексии",
			}),
		];
		await syncDealVisitSummaries(bitrix, NOW, { logsApi });
		expect(dealGets).toEqual([{ id: "501" }]);
		expect(bitrixCalls[0]?.params).toMatchObject({
			id: "501",
			fields: {
				UTM_SOURCE: "yandex",
				UTM_MEDIUM: "cpc",
				UTM_CAMPAIGN: "search_anorexia_708811857",
				UTM_CONTENT: "17000000123_premium_mobile",
				UTM_TERM: "лечение анорексии",
			},
		});
	});

	test("настоящую метку кампании в сделке не трогаем", async () => {
		rows = [visitRow(AD_VISIT)];
		await syncDealVisitSummaries(bitrix, NOW, { logsApi });
		const update = bitrixCalls[0]?.params as { fields: object } | undefined;
		expect(update?.fields).toBeDefined();
		expect(update?.fields).not.toHaveProperty("UTM_CAMPAIGN");
	});

	test("без рекламного визита сделку в Bitrix не читаем", async () => {
		await syncDealVisitSummaries(bitrix, NOW, { logsApi });
		expect(dealGets).toHaveLength(0);
	});

	test("«нет визитов», записанное до полной статистики, перепроверяется", async () => {
		deals = [
			{
				dealId: "6208",
				clientId: CLIENT_ID,
				createdAt: new Date("2026-10-08T09:00:00Z"), // 08.10, 12:00 МСК
				visitsSummaryStatus: "no_visits",
				// 09.10, 00:24 МСК — до 08:00, данные за 08.10 ещё неполные
				visitsSummarizedAt: new Date("2026-10-08T21:24:00Z"),
			},
			{
				dealId: "6209",
				clientId: "999999999999999999",
				createdAt: new Date("2026-10-08T09:00:00Z"),
				visitsSummaryStatus: "no_visits",
				// 09.10, 10:00 МСК — после 08:00, итог окончательный
				visitsSummarizedAt: new Date("2026-10-09T07:00:00Z"),
			},
		];
		const result = await syncDealVisitSummaries(bitrix, NOW, { logsApi });
		expect(result).toMatchObject({ deals: 1, done: 1 });
		expect(marked).toEqual([["6208", "done"]]);
	});

	test("сбой отчёта Директа не мешает записать остальное", async () => {
		rows = [visitRow(AD_VISIT)];
		const result = await syncDealVisitSummaries(bitrix, NOW, {
			logsApi,
			searchQueryReport: () => Promise.reject(new Error("Директ недоступен")),
		});
		expect(result).toMatchObject({
			done: 0,
			searchQueries: 0,
			pendingSearchQueries: 1,
		});
		expect(marked).toContainEqual(["501", "pending_search_query"]);
		expect(bitrixCalls[0]?.method).toBe("crm.deal.update");
	});

	test.each([{ reportRows: [] }, { reportRows: null }])(
		"пустой отчёт или отсутствие учётных данных оставляет поиск на следующий прогон: %j",
		async ({ reportRows }) => {
			rows = [visitRow(AD_VISIT)];
			const result = await syncDealVisitSummaries(bitrix, NOW, {
				logsApi,
				searchQueryReport: () => Promise.resolve(reportRows),
			});
			expect(result).toMatchObject({ done: 0, pendingSearchQueries: 1 });
			expect(marked).toContainEqual(["501", "pending_search_query"]);
			expect(bitrixCalls.map((call) => call.method)).toEqual([
				"crm.deal.update",
				"crm.timeline.comment.add",
			]);
			expect(JSON.stringify(bitrixCalls)).not.toContain(
				"Поисковый запрос (отчёт Директа)",
			);
		},
	);

	test("повторный прогон дописывает только найденный запрос и завершает сделку", async () => {
		settings = {
			...settings,
			bitrixAdDealFields: { searchQuery: "UF_CRM_QUERY" },
		};
		rows = [visitRow(AD_VISIT)];
		await syncDealVisitSummaries(bitrix, NOW, { logsApi });
		deals = deals
			.filter((deal) => deal.dealId === "501")
			.map((deal) => ({
				...deal,
				visitsSummaryStatus: "pending_search_query",
			}));
		bitrixCalls.length = 0;
		marked.length = 0;
		const waiting = await syncDealVisitSummaries(bitrix, NOW, { logsApi });
		expect(waiting.pendingSearchQueries).toBe(1);
		expect(bitrixCalls).toHaveLength(0);
		expect(marked).toHaveLength(0);

		const result = await syncDealVisitSummaries(bitrix, NOW, {
			logsApi,
			searchQueryReport: () =>
				Promise.resolve([{ AdGroupId: "5600000111", Query: "новый запрос" }]),
		});
		expect(result).toMatchObject({
			done: 1,
			searchQueries: 1,
			pendingSearchQueries: 0,
		});
		expect(bitrixCalls).toEqual([
			{
				method: "crm.deal.update",
				params: { id: "501", fields: { UF_CRM_QUERY: "новый запрос" } },
			},
			{
				method: "crm.timeline.comment.add",
				params: {
					fields: {
						ENTITY_ID: 501,
						ENTITY_TYPE: "deal",
						COMMENT: "Поисковый запрос (отчёт Директа): новый запрос",
					},
				},
			},
		]);
		expect(marked).toEqual([["501", "done"]]);
	});

	test.each(["search", "context"])(
		"отсутствующие значения выбранного визита очищаются: %s",
		async (platform) => {
			settings = {
				...settings,
				bitrixAdDealFields: {
					campaign: "UF_CAMPAIGN",
					adGroup: "UF_GROUP",
					ad: "UF_AD",
					region: "UF_REGION",
					clickPosition: "UF_POSITION",
					landingPage: "UF_PAGE",
					searchQuery: "UF_QUERY",
				},
			};
			rows = [
				visitRow(AD_VISIT),
				visitRow({
					visitID: "1003",
					dateTime: "2026-10-08 11:55:00",
					lastTrafficSource: "ad",
					lastAdvEngine: "ya_direct",
					lastDirectPlatformType: platform,
					startURL: "https://psi-opora.ru/new/",
					regionCity: "",
					lastDirectBannerGroup: "5600000042",
				}),
			];
			const reportCalls: unknown[] = [];
			const result = await syncDealVisitSummaries(bitrix, NOW, {
				logsApi,
				searchQueryReport: (clicks) => {
					reportCalls.push(clicks);
					return Promise.resolve([]);
				},
			});
			expect(bitrixCalls[0]?.params).toEqual({
				id: "501",
				fields: {
					UF_CRM_VISITS: "2",
					UF_CAMPAIGN: "",
					UF_GROUP: "5600000042",
					UF_AD: "",
					UF_REGION: "",
					UF_POSITION: "",
					UF_PAGE: "https://psi-opora.ru/new/",
					UF_QUERY: "",
				},
			});
			expect(result.pendingSearchQueries).toBe(platform === "search" ? 1 : 0);
			expect(reportCalls).toHaveLength(platform === "search" ? 1 : 0);
		},
	);

	test("до 08:00 МСК вчерашние сделки ждут полной статистики", async () => {
		await syncDealVisitSummaries(bitrix, new Date("2026-10-10T03:00:00Z"), {
			logsApi,
		});
		expect(listCalls[0]?.until).toEqual(new Date("2026-10-08T21:00:00Z"));
	});

	test("без кодов полей сводка уходит только в таймлайн", async () => {
		settings = { counterId: "12345678", oauthToken: "token" };
		await syncDealVisitSummaries(bitrix, NOW, { logsApi });
		expect(bitrixCalls.map((c) => c.method)).toEqual([
			"crm.timeline.comment.add",
		]);
	});

	test("новых сделок нет — в Метрику не ходим", async () => {
		deals = [];
		const result = await syncDealVisitSummaries(bitrix, NOW, { logsApi });
		expect(result.deals).toBe(0);
		expect(visitsCalls).toHaveLength(0);
	});

	test("Метрика не настроена — шаг пропускается", async () => {
		settings = null;
		const result = await syncDealVisitSummaries(bitrix, NOW, { logsApi });
		expect(result.skipped).toBe(true);
		expect(listCalls).toHaveLength(0);
	});

	test("сбой Bitrix оставляет сделку на следующий прогон", async () => {
		const failing = {
			call: () => Promise.reject(new Error("Bitrix недоступен")),
		};
		const result = await syncDealVisitSummaries(failing, NOW, { logsApi });
		expect(result.failed).toBe(1);
		expect(marked).toEqual([["502", "no_visits"]]);
	});
});
