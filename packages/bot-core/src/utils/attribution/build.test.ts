import { describe, expect, test } from "bun:test";
import type { AdTouch } from "@psi-opora/db/queries";
import { entityKey } from "./ad-directory";
import { buildAttribution, collectEntityRefs } from "./build";

function touch(overrides: Partial<AdTouch>): AdTouch {
	return {
		id: crypto.randomUUID(),
		ymClientId: "163972457524306386",
		yclid: null,
		utmSource: "yandex",
		utmMedium: "cpc",
		utmCampaign: null,
		utmContent: null,
		utmTerm: null,
		adCampaignId: null,
		adGroupId: null,
		adId: null,
		keywordId: null,
		landingUrl: null,
		referrer: null,
		occurredAt: new Date("2026-10-09T09:03:00Z"),
		...overrides,
	};
}

const names = new Map([
	[entityKey("campaign", "708811857"), "Анорексия — поиск"],
	[entityKey("group", "5600000111"), "Лечение анорексии"],
	[entityKey("ad", "17000000123"), "Помощь при анорексии"],
	[entityKey("keyword", "1234567890"), "лечение анорексии"],
]);

const full = {
	utmCampaign: "708811857",
	adCampaignId: "708811857",
	adGroupId: "5600000111",
	adId: "17000000123",
	utmContent: "17000000123",
	keywordId: "1234567890",
	utmTerm: "лечение анорексии",
};

describe("buildAttribution", () => {
	test("без касаний — null (сделка идёт по старой схеме)", () => {
		expect(buildAttribution({ touches: [], names })).toBeNull();
	});

	test("одно касание: UTM-поля, читаемое описание и роль first_last", () => {
		const t = touch(full);
		const result = buildAttribution({ touches: [t], names });
		expect(result).toMatchObject({
			utmSource: "yandex",
			utmMedium: "cpc",
			// метка кампании остаётся исходной — по числовому ID сматчится расход
			utmCampaign: "708811857",
			// в карточке видно название объявления, ID оставляет метку уникальной
			utmContent: "Помощь при анорексии (17000000123)",
			utmTerm: "лечение анорексии",
		});
		expect(result?.sourceDescription).toBe(
			"Яндекс.Директ · РК «Анорексия — поиск» · группа «Лечение анорексии» · объявление «Помощь при анорексии» (17000000123) · ключ «лечение анорексии»",
		);
		expect(result?.touches).toEqual([{ id: t.id, role: "first_last" }]);
		expect(result?.commentLines).toHaveLength(1);
	});

	test("цепочка из трёх касаний: UTM — с последнего, роли first/middle/last", () => {
		const a = touch({
			...full,
			utmCampaign: "111111111",
			adCampaignId: "111111111",
			occurredAt: new Date("2026-10-01T08:00:00Z"),
		});
		const b = touch({
			utmSource: "vk",
			utmMedium: "social",
			utmCampaign: "vk_retarget",
			occurredAt: new Date("2026-10-05T08:00:00Z"),
		});
		const c = touch({ ...full, occurredAt: new Date("2026-10-09T09:03:00Z") });
		const result = buildAttribution({ touches: [a, b, c], names });

		expect(result?.utmCampaign).toBe("708811857");
		expect(result?.touches.map((t) => t.role)).toEqual([
			"first",
			"middle",
			"last",
		]);
		expect(result?.commentLines).toEqual([
			expect.stringContaining("последнее касание"),
			expect.stringContaining("первое касание"),
			"Касаний с рекламой: 3",
		]);
		// даты в таймлайне — по Москве
		expect(result?.timelineComment).toContain("09.10.2026, 12:03 МСК");
		expect(result?.timelineComment).toContain(
			"Касания с рекламой до заявки (3):",
		);
		expect(result?.timelineComment).toContain("vk · РК «vk_retarget»");
	});

	test("названия не нашлись — в описании ID, метка кампании не теряется", () => {
		const result = buildAttribution({
			touches: [touch(full)],
			names: new Map(),
		});
		expect(result?.sourceDescription).toBe(
			"Яндекс.Директ · РК 708811857 · группа 5600000111 · объявление 17000000123 · ключ «лечение анорексии»",
		);
		expect(result?.utmContent).toBe("17000000123");
	});

	test("текстовая метка кампании показывается как название, если кабинет не ответил", () => {
		const result = buildAttribution({
			touches: [touch({ utmCampaign: "rsya_retarget_anorexia_v2" })],
			names: new Map(),
		});
		expect(result?.sourceDescription).toBe(
			"Яндекс.Директ · РК «rsya_retarget_anorexia_v2»",
		);
	});

	test("нет метки кампании в касании — берём из ссылки на бота", () => {
		const result = buildAttribution({
			touches: [touch({ utmSource: null, yclid: "9876543210987654321" })],
			names: new Map(),
			linkSource: "yandex",
			linkCampaign: "search_anorexia_708811857",
		});
		expect(result).toMatchObject({
			utmSource: "yandex",
			utmCampaign: "search_anorexia_708811857",
		});
	});

	test("страница захода попадает в таймлайн", () => {
		const result = buildAttribution({
			touches: [touch({ landingUrl: "https://psi-opora.ru/anorexia/" })],
			names,
		});
		expect(result?.timelineComment).toContain(
			"Страница: https://psi-opora.ru/anorexia/",
		);
	});
});

describe("collectEntityRefs", () => {
	test("собирает уникальные ID по видам, пропуская пустые", () => {
		const refs = collectEntityRefs([
			touch(full),
			touch({ ...full, adId: "17000000999" }),
			touch({}),
		]);
		expect(refs).toEqual({
			campaignIds: ["708811857"],
			groupIds: ["5600000111"],
			adIds: ["17000000123", "17000000999"],
			keywordIds: ["1234567890"],
		});
	});
});
