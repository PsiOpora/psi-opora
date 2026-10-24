import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { PendingAdSearchQueryLookup } from "@psi-opora/db/queries";
import type { DirectReportParams, DirectReportRow } from "../direct-reports";

let pending: PendingAdSearchQueryLookup[] = [];
let metrikaConfigured = false;
const lookupCalls: Array<[number | undefined, boolean | undefined]> = [];
let reportRows: DirectReportRow[] = [];
let fieldCode: string | undefined = "UF_CRM_SEARCH_QUERY";
const resolved: Array<{ dealId: string; result: unknown }> = [];
const bumped: string[] = [];
const reportCalls: DirectReportParams[] = [];

mock.module("@psi-opora/db/queries", () => ({
	getAdCredentials: () =>
		Promise.resolve({
			yandexClientId: "id",
			yandexClientSecret: "secret",
			yandexRefreshToken: "refresh",
			yandexClientLogin: "psi-opora",
		}),
	getYandexMetrikaSettings: () =>
		Promise.resolve({
			bitrixAdDealFields: fieldCode ? { searchQuery: fieldCode } : {},
			counterId: metrikaConfigured ? "123" : null,
			oauthToken: metrikaConfigured ? "local-token" : null,
		}),
	listPendingAdSearchQueryLookups: (
		limit?: number,
		excludeMetrikaDeals?: boolean,
	) => {
		lookupCalls.push([limit, excludeMetrikaDeals]);
		return Promise.resolve(pending);
	},
	resolveAdSearchQueryLookup: (dealId: string, result: unknown) => {
		resolved.push({ dealId, result });
		return Promise.resolve();
	},
	bumpAdSearchQueryLookupAttempt: (dealId: string) => {
		bumped.push(dealId);
		return Promise.resolve();
	},
}));
mock.module("../ads-stats", () => ({
	getYandexToken: () => Promise.resolve("token"),
}));
mock.module("../direct-reports", () => ({
	fetchDirectReport: (params: DirectReportParams) => {
		reportCalls.push(params);
		return Promise.resolve(reportRows);
	},
}));

const { matchSearchQuery, mskDate, resolvePendingSearchQueries } = await import(
	"./search-queries"
);

// 23:30 МСК 08.10 — по Москве это ещё 8-е, хотя в UTC уже 20:30 того же дня.
const CLICKED_AT = new Date("2026-10-08T20:30:00Z");

function lookup(
	overrides: Partial<PendingAdSearchQueryLookup> = {},
): PendingAdSearchQueryLookup {
	return {
		dealId: "501",
		messenger: "telegram",
		attempts: 0,
		adGroupId: "5600000111",
		adId: "17000000123",
		keywordId: "1234567890",
		clickedAt: CLICKED_AT,
		...overrides,
	};
}

function row(overrides: Partial<DirectReportRow>): DirectReportRow {
	return {
		Date: "2026-10-08",
		AdGroupId: "5600000111",
		AdId: "17000000123",
		CriterionId: "1234567890",
		Query: "лечение анорексии спб",
		Clicks: "1",
		...overrides,
	};
}

describe("matchSearchQuery", () => {
	test("единственный запрос с кликом — это и есть запрос клиента", () => {
		expect(matchSearchQuery(lookup(), [row({})])).toBe("лечение анорексии спб");
	});

	test("день клика считается по Москве", () => {
		expect(mskDate(CLICKED_AT)).toBe("2026-10-08");
		expect(mskDate(new Date("2026-10-08T21:30:00Z"))).toBe("2026-10-09");
		expect(
			matchSearchQuery(lookup(), [row({ Date: "2026-10-09" })]),
		).toBeUndefined();
	});

	test("чужие группы, объявления и запросы без кликов не подходят", () => {
		expect(
			matchSearchQuery(lookup(), [
				row({ AdGroupId: "5600000999" }),
				row({ AdId: "17000000999" }),
				row({ Clicks: "0" }),
			]),
		).toBeUndefined();
	});

	test("ключ уточняет выбор, но не обязателен для автотаргетинга", () => {
		const rows = [
			row({ Query: "анорексия лечение" }),
			row({ CriterionId: "999", Query: "клиника рпп" }),
		];
		expect(matchSearchQuery(lookup(), rows)).toBe("анорексия лечение");
		expect(
			matchSearchQuery(lookup({ keywordId: "555" }), [
				row({ CriterionId: "777", Query: "клиника рпп" }),
			]),
		).toBe("клиника рпп");
	});

	test("несколько запросов — самые кликабельные как вероятные", () => {
		const rows = [
			row({ Query: "а", Clicks: "1" }),
			row({ Query: "б", Clicks: "5" }),
			row({ Query: "в", Clicks: "2" }),
			row({ Query: "г", Clicks: "1" }),
			row({ Query: "б", Clicks: "1" }),
		];
		expect(matchSearchQuery(lookup(), rows)).toBe(
			"вероятно: б / в / а и ещё 1",
		);
	});
});

describe("resolvePendingSearchQueries", () => {
	const bitrixCalls: Array<{ method: string; params: unknown }> = [];
	const bitrix = {
		call: (method: string, params: Record<string, unknown>) => {
			bitrixCalls.push({ method, params });
			return Promise.resolve(true);
		},
	};
	// 09.10, 10:00 МСК — день клика (08.10) уже посчитан.
	const NOW = new Date("2026-10-09T07:00:00Z");

	beforeEach(() => {
		pending = [lookup()];
		metrikaConfigured = false;
		lookupCalls.length = 0;
		reportRows = [row({})];
		fieldCode = "UF_CRM_SEARCH_QUERY";
		resolved.length = 0;
		bumped.length = 0;
		reportCalls.length = 0;
		bitrixCalls.length = 0;
	});

	test("находит запрос, пишет его в поле и таймлайн сделки", async () => {
		const result = await resolvePendingSearchQueries(bitrix, NOW);
		expect(result).toMatchObject({ checked: 1, found: 1, waiting: 0 });
		expect(reportCalls[0]).toMatchObject({
			reportType: "SEARCH_QUERY_PERFORMANCE_REPORT",
			clientLogin: "psi-opora",
			dateFrom: "2026-10-08",
			dateTo: "2026-10-08",
		});
		expect(reportCalls[0]?.filter?.[0]).toEqual({
			Field: "AdGroupId",
			Operator: "IN",
			Values: ["5600000111"],
		});
		expect(bitrixCalls[0]).toEqual({
			method: "crm.deal.update",
			params: {
				id: "501",
				fields: { UF_CRM_SEARCH_QUERY: "лечение анорексии спб" },
			},
		});
		expect(bitrixCalls[1]?.method).toBe("crm.timeline.comment.add");
		expect(resolved).toEqual([
			{
				dealId: "501",
				result: { status: "found", query: "лечение анорексии спб" },
			},
		]);
	});

	test.each([true, false])(
		"при настроенной Метрике исключает сделки с ClientID из очереди: %s",
		async (configured) => {
			metrikaConfigured = configured;
			await resolvePendingSearchQueries(bitrix, NOW);
			expect(lookupCalls).toEqual([[200, configured]]);
		},
	);

	test("без кода поля запрос уходит только в таймлайн", async () => {
		fieldCode = undefined;
		await resolvePendingSearchQueries(bitrix, NOW);
		expect(bitrixCalls.map((call) => call.method)).toEqual([
			"crm.timeline.comment.add",
		]);
	});

	test("день клика ещё не посчитан — отчёт не запрашиваем", async () => {
		const result = await resolvePendingSearchQueries(
			bitrix,
			new Date("2026-10-08T22:00:00Z"),
		);
		expect(result).toMatchObject({ checked: 0, waiting: 1 });
		expect(reportCalls).toHaveLength(0);
	});

	test("запроса пока нет — пробуем снова, через 3 дня перестаём", async () => {
		reportRows = [];
		await resolvePendingSearchQueries(bitrix, NOW);
		expect(bumped).toEqual(["501"]);
		expect(resolved).toHaveLength(0);

		const result = await resolvePendingSearchQueries(
			bitrix,
			new Date("2026-10-12T07:00:00Z"),
		);
		expect(result.notFound).toBe(1);
		expect(resolved).toEqual([
			{ dealId: "501", result: { status: "not_found" } },
		]);
	});

	test("сбой Bitrix оставляет сделку в очереди", async () => {
		const failing = {
			call: () => Promise.reject(new Error("Bitrix недоступен")),
		};
		const result = await resolvePendingSearchQueries(failing, NOW);
		expect(result.found).toBe(0);
		expect(resolved).toHaveLength(0);
	});
});
