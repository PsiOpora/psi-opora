import { describe, expect, test } from "bun:test";
import { buildContactNameFilters, parseCrmSearchQuery } from "./crm-search";

describe("parseCrmSearchQuery", () => {
	test("полный телефон в любом формате нормализуется", () => {
		expect(parseCrmSearchQuery("8 (916) 123-45-67")).toEqual({
			phone: "+79161234567",
			nameTokens: [],
		});
		expect(parseCrmSearchQuery("+7 916 123 45 67").phone).toBe("+79161234567");
	});

	test("частичный номер в CRM не ищем", () => {
		expect(parseCrmSearchQuery("123-45-67")).toEqual({
			phone: null,
			nameTokens: [],
		});
	});

	test("фамилия и имя разбиваются на слова", () => {
		expect(parseCrmSearchQuery("  Иванова   Мария ")).toEqual({
			phone: null,
			nameTokens: ["Иванова", "Мария"],
		});
	});

	test("слишком короткие слова и лишние слова отбрасываются", () => {
		expect(parseCrmSearchQuery("И").nameTokens).toEqual([]);
		expect(parseCrmSearchQuery("а б в г д Иванова").nameTokens).toEqual([
			"Иванова",
		]);
		expect(
			parseCrmSearchQuery("Анна Мария Петрова Сидорова").nameTokens,
		).toEqual(["Анна", "Мария"]);
	});

	test("пустой запрос", () => {
		expect(parseCrmSearchQuery("   ")).toEqual({ phone: null, nameTokens: [] });
	});
});

describe("buildContactNameFilters", () => {
	test("одно слово — фамилия или имя, два отдельных запроса", () => {
		expect(buildContactNameFilters(["Иванова"])).toEqual([
			{ "%LAST_NAME": "Иванова" },
			{ "%NAME": "Иванова" },
		]);
	});

	test("два слова — оба порядка одним AND-фильтром каждый", () => {
		expect(buildContactNameFilters(["Иванова", "Мария"])).toEqual([
			{ "%LAST_NAME": "Иванова", "%NAME": "Мария" },
			{ "%LAST_NAME": "Мария", "%NAME": "Иванова" },
		]);
	});

	test("нет слов — нет запросов", () => {
		expect(buildContactNameFilters([])).toEqual([]);
	});
});
