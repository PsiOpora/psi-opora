import { describe, expect, test } from "bun:test";
import {
	extractYmClientId,
	isValidCampaignKeyword,
	parseUtmParams,
	splitStartParam,
} from "./utm";

describe("parseUtmParams", () => {
	test("декодирует percent-encoded код до поиска в справочнике", () => {
		expect(
			parseUtmParams(
				"%D0%A0%D0%9A-%20%D0%9E%D0%9A%D0%A0%20%D0%BF%D0%BE%20%D0%BA%D0%BE%D0%BD%D0%B2%D0%B5%D1%80%D1%81%D0%B8%D1%8F%D0%BC",
			),
		).toEqual({
			source: "yandex",
			campaign: "РК- ОКР по конверсиям",
		});
	});

	test("декодирует неизвестную кампанию перед сохранением", () => {
		expect(parseUtmParams("%D0%A2%D0%B5%D1%81%D1%82")).toEqual({
			campaign: "Тест",
		});
	});

	test("не падает на некорректном percent-encoding", () => {
		expect(parseUtmParams("campaign%broken")).toEqual({
			campaign: "campaign%broken",
		});
	});
});

describe("splitStartParam", () => {
	test("без подчёркивания — всё слово целиком, источника нет", () => {
		expect(splitStartParam("SCHOOL")).toEqual({ keyword: "SCHOOL" });
	});

	test("делит по первому подчёркиванию на слово и источник", () => {
		expect(splitStartParam("SCHOOL_VK")).toEqual({
			keyword: "SCHOOL",
			source: "VK",
		});
	});

	test("источник может сам содержать подчёркивание — делится только один раз", () => {
		expect(splitStartParam("SCHOOL_tg_ads")).toEqual({
			keyword: "SCHOOL",
			source: "tg_ads",
		});
	});

	test("пустая часть до/после подчёркивания — без источника, всё слово целиком", () => {
		expect(splitStartParam("_VK")).toEqual({ keyword: "_VK" });
		expect(splitStartParam("SCHOOL_")).toEqual({ keyword: "SCHOOL_" });
	});
});

describe("extractYmClientId", () => {
	test("нет суффикса — код возвращается как есть, ClientID нет", () => {
		expect(extractYmClientId("search_anorexia_708811857")).toEqual({
			code: "search_anorexia_708811857",
		});
	});

	test("отрезает суффикс _ymNNN и возвращает остаток отдельно", () => {
		expect(
			extractYmClientId("search_anorexia_708811857_ym163972457524306386"),
		).toEqual({
			code: "search_anorexia_708811857",
			ymClientId: "163972457524306386",
		});
	});

	test("работает и с коротким кодом без источника", () => {
		expect(extractYmClientId("SCHOOL_VK_ym1234567890")).toEqual({
			code: "SCHOOL_VK",
			ymClientId: "1234567890",
		});
	});

	test("слишком короткое число после _ym не считается ClientID", () => {
		expect(extractYmClientId("SCHOOL_ym123")).toEqual({
			code: "SCHOOL_ym123",
		});
	});

	test("undefined остаётся undefined", () => {
		expect(extractYmClientId(undefined)).toEqual({ code: undefined });
	});
});

describe("isValidCampaignKeyword", () => {
	test("латиница, цифры и дефис — можно", () => {
		expect(isValidCampaignKeyword("SCHOOL-2")).toBe(true);
	});

	test("подчёркивание нельзя — конфликтует с разделителем источника", () => {
		expect(isValidCampaignKeyword("SCHOOL_2")).toBe(false);
	});

	test("кириллица нельзя — не пройдёт в start-параметр", () => {
		expect(isValidCampaignKeyword("ШКОЛА")).toBe(false);
	});
});
