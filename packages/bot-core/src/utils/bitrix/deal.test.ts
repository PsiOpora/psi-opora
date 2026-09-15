import { describe, expect, test } from "bun:test";
import { resolveDisorderIds } from "./deal";

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
