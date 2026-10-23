import { describe, expect, test } from "bun:test";
import type { LogsVisitRow } from "./logs-api";
import {
	formatDuration,
	type SiteVisit,
	summarizeVisits,
	toSiteVisit,
} from "./summary";

const CLIENT_ID = "163972457524306386";
const DEAL_CREATED_AT = new Date("2026-10-09T09:00:00Z"); // 12:00 МСК

function row(overrides: Partial<LogsVisitRow> = {}): LogsVisitRow {
	return {
		visitID: "1001",
		clientID: CLIENT_ID,
		dateTime: "2026-10-09 11:40:00",
		startURL: "https://psi-opora.ru/anorexia/",
		endURL: "https://psi-opora.ru/contacts/",
		pageViews: "3",
		visitDuration: "200",
		bounce: "0",
		regionCity: "Saint Petersburg",
		regionCountry: "RU",
		deviceCategory: "2",
		operatingSystemRoot: "iOS",
		browser: "Safari",
		lastTrafficSource: "ad",
		lastAdvEngine: "ya_direct",
		lastSearchEngineRoot: "",
		lastReferalSource: "",
		lastUTMSource: "yandex",
		lastUTMMedium: "cpc",
		lastUTMCampaign: "search_anorexia_708811857",
		goalsID: "[123,456]",
		...overrides,
	};
}

function visit(overrides: Partial<LogsVisitRow> = {}): SiteVisit {
	const parsed = toSiteVisit(row(overrides));
	if (!parsed) throw new Error("невалидный визит в тесте");
	return parsed;
}

const goals = new Map([
	["123", "Просмотр цен"],
	["456", "Открыл форму записи"],
]);

describe("toSiteVisit", () => {
	test("время визита — по Москве, устройство и источник читаемо", () => {
		expect(visit()).toMatchObject({
			visitId: "1001",
			startedAt: new Date("2026-10-09T08:40:00Z"),
			device: "смартфон · iOS · Safari",
			source: "реклама (Яндекс.Директ, кампания search_anorexia_708811857)",
			goalIds: ["123", "456"],
			bounce: false,
		});
	});

	test("поиск и переходы с сайтов подписываются системой/сайтом", () => {
		expect(
			visit({
				lastTrafficSource: "organic",
				lastSearchEngineRoot: "yandex",
				lastUTMCampaign: "",
				lastUTMSource: "",
			}).source,
		).toBe("поиск (yandex)");
		expect(
			visit({
				lastTrafficSource: "referral",
				lastReferalSource: "vk.com",
				lastUTMCampaign: "",
				lastUTMSource: "",
			}).source,
		).toBe("переход с сайта (vk.com)");
	});

	test("без даты или ClientID визит пропускается", () => {
		expect(toSiteVisit(row({ dateTime: "" }))).toBeNull();
		expect(toSiteVisit(row({ clientID: "" }))).toBeNull();
	});
});

describe("summarizeVisits", () => {
	test("сводка: число визитов, первый визит и источник, страницы, время, цели", () => {
		const summary = summarizeVisits(
			[
				visit(),
				visit({
					visitID: "1000",
					dateTime: "2026-10-01 20:00:00",
					lastTrafficSource: "organic",
					lastSearchEngineRoot: "yandex",
					lastUTMCampaign: "",
					lastUTMSource: "",
					pageViews: "1",
					visitDuration: "15",
					bounce: "1",
					goalsID: "[]",
					deviceCategory: "1",
					operatingSystemRoot: "Windows",
					browser: "Chrome",
				}),
			],
			DEAL_CREATED_AT,
			goals,
		);
		expect(summary?.fields).toEqual({
			visitCount: "2",
			firstVisitAt: "01.10.2026",
			firstSource: "поиск (yandex)",
			pageViews: "4",
			timeOnSite: "3 мин 35 с",
			// город и устройство — с последнего визита, перед заявкой
			city: "Saint Petersburg",
			device: "смартфон · iOS · Safari",
			goals: "Просмотр цен, Открыл форму записи",
		});
		expect(summary?.timelineComment).toContain(
			"Визиты на сайт до заявки (Метрика): 2, первый — 01.10.2026",
		);
		expect(summary?.timelineComment).toContain(
			"1. 01.10.2026, 20:00 МСК — поиск (yandex) · отказ",
		);
		expect(summary?.timelineComment).toContain(
			"цели: Просмотр цен, Открыл форму записи",
		);
		expect(summary?.timelineComment).toContain(
			"   Вход: https://psi-opora.ru/anorexia/",
		);
	});

	test("визиты после заявки и старше 30 дней не учитываются, дубли — один раз", () => {
		const summary = summarizeVisits(
			[
				visit(),
				visit(),
				visit({ visitID: "2000", dateTime: "2026-10-09 15:00:00" }),
				visit({ visitID: "999", dateTime: "2026-09-01 10:00:00" }),
			],
			DEAL_CREATED_AT,
			goals,
		);
		expect(summary?.fields.visitCount).toBe("1");
	});

	test("нет визитов до заявки — null", () => {
		expect(
			summarizeVisits(
				[visit({ dateTime: "2026-10-09 15:00:00" })],
				DEAL_CREATED_AT,
				goals,
			),
		).toBeNull();
	});

	test("неизвестная цель подписывается номером", () => {
		const summary = summarizeVisits(
			[visit({ goalsID: "[789]" })],
			DEAL_CREATED_AT,
			new Map(),
		);
		expect(summary?.fields.goals).toBe("цель 789");
	});
});

describe("formatDuration", () => {
	test("секунды, минуты и их сочетание", () => {
		expect(formatDuration(45)).toBe("45 с");
		expect(formatDuration(120)).toBe("2 мин");
		expect(formatDuration(215)).toBe("3 мин 35 с");
	});
});
