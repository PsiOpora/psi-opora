import { describe, expect, test } from "bun:test";
import { parseCrmSearchQuery } from "./crm-search";

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
		).toEqual(["Анна", "Мария", "Петрова"]);
	});

	test("пустой запрос", () => {
		expect(parseCrmSearchQuery("   ")).toEqual({ phone: null, nameTokens: [] });
	});
});
