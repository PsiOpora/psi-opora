import { beforeEach, describe, expect, test } from "bun:test";
import type { DealAttribution } from "../attribution/build";
import { buildDealFields, resolveDisorderIds } from "./deal";
import type { DealData } from "./types";

describe("resolveDisorderIds", () => {
	test("узнаёт тему по подстроке в названии кампании", () => {
		expect(resolveDisorderIds("search_anorexia_708811857")).toEqual(["46"]);
		expect(resolveDisorderIds("rsya_retarget_anorexia_v2")).toEqual(["46"]);
	});

	test("узнаёт короткую метку только как отдельный токен", () => {
		expect(resolveDisorderIds("direct_okr")).toEqual(["56"]);
		expect(resolveDisorderIds("РК- ОКР по конверсиям")).toEqual(["56"]);
		expect(resolveDisorderIds("sokr_test")).toEqual([]);
	});

	test("может вернуть несколько тем сразу", () => {
		expect(resolveDisorderIds("anorexia_okr_promo").sort()).toEqual([
			"46",
			"56",
		]);
	});

	test("не находит совпадений — возвращает пустой список", () => {
		expect(resolveDisorderIds("SCHOOL")).toEqual([]);
		expect(resolveDisorderIds("main_banner")).toEqual([]);
		expect(resolveDisorderIds(undefined)).toEqual([]);
	});
});

describe("buildDealFields с атрибуцией по касаниям", () => {
	const base: DealData = {
		name: "Анна",
		phone: "+79990000000",
		messenger: "telegram",
		source: "psi-opora.ru",
		campaign: "main_banner",
		flow: "consult",
	};
	const attribution: DealAttribution = {
		utmSource: "yandex",
		utmMedium: "cpc",
		utmCampaign: "708811857",
		utmContent: "Помощь при анорексии (17000000123)",
		utmTerm: "лечение анорексии",
		sourceDescription:
			"Яндекс.Директ · РК «Анорексия — поиск» · объявление «Помощь при анорексии» (17000000123)",
		commentLines: ["Реклама (последнее касание): Яндекс.Директ"],
		timelineComment: "Касания с рекламой до заявки (1):",
		touches: [{ id: "t1", role: "first_last" }],
	};

	beforeEach(() => {
		process.env.TG_BITRIX_SOURCE_ID = "TG_SRC";
		process.env.TG_BOT_ID = "main_tg_bot";
	});

	test("без касаний — прежняя схема: метка из ссылки, канал и бот в UTM", async () => {
		const fields = await buildDealFields(base, 7);
		expect(fields).toMatchObject({
			UTM_SOURCE: "psi-opora.ru",
			UTM_MEDIUM: "telegram_bot",
			UTM_CAMPAIGN: "main_banner",
			UTM_CONTENT: "main_tg_bot",
			SOURCE_DESCRIPTION: "psi-opora.ru / main_banner",
		});
		expect(fields).not.toHaveProperty("UTM_TERM");
	});

	test("с касаниями — UTM последнего касания и читаемое описание источника", async () => {
		const fields = await buildDealFields({ ...base, attribution }, 7);
		expect(fields).toMatchObject({
			UTM_SOURCE: "yandex",
			UTM_MEDIUM: "cpc",
			UTM_CAMPAIGN: "708811857",
			UTM_CONTENT: "Помощь при анорексии (17000000123)",
			UTM_TERM: "лечение анорексии",
			SOURCE_DESCRIPTION: attribution.sourceDescription,
		});
		// какой именно бот — по-прежнему видно в комментарии
		expect(fields.COMMENTS).toContain("Бот: main_tg_bot");
		expect(fields.COMMENTS).toContain("Реклама (последнее касание)");
	});

	test("тема расстройства читается из названия кампании, даже если метка — число", async () => {
		const fields = await buildDealFields(
			{
				...base,
				campaign: undefined,
				attribution: {
					...attribution,
					sourceDescription: "Яндекс.Директ · РК «Булимия — поиск»",
				},
			},
			7,
		);
		expect(fields.UF_CRM_1779041362411).toEqual(["48"]);
	});
});
