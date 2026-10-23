import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { LogsVisitRow } from "./logs-api";

const CLIENT_ID = "163972457524306386";

let settings: Record<string, unknown> | null = null;
let deals: Array<{ dealId: string; clientId: string; createdAt: Date }> = [];
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

describe("syncDealVisitSummaries", () => {
	const bitrixCalls: Array<{ method: string; params: unknown }> = [];
	const bitrix = {
		call: (method: string, params: Record<string, unknown>) => {
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
