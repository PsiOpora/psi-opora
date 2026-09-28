import { describe, expect, test } from "bun:test";
import { extractPhones, formatPhone, normalizePhone, samePhone } from "./phone";

describe("normalizePhone", () => {
	test("приводит российские варианты записи к +7", () => {
		expect(normalizePhone("8 (999) 123-45-67")).toBe("+79991234567");
		expect(normalizePhone("79991234567")).toBe("+79991234567");
		expect(normalizePhone("+7 999 123 45 67")).toBe("+79991234567");
		expect(normalizePhone("9991234567")).toBe("+79991234567");
	});

	test("оставляет международные номера как есть", () => {
		expect(normalizePhone("+375 29 123-45-67")).toBe("+375291234567");
		expect(normalizePhone("+49 151 23456789")).toBe("+4915123456789");
	});

	test("отклоняет то, что не похоже на телефон", () => {
		expect(normalizePhone("")).toBeNull();
		expect(normalizePhone("12345")).toBeNull();
		expect(normalizePhone("телефон 89991234567")).toBeNull();
		expect(normalizePhone("2200 1234 5678 9012")).toBeNull();
		expect(normalizePhone("1234567890")).toBeNull();
	});
});

describe("extractPhones", () => {
	test("находит номер внутри фразы", () => {
		expect(
			extractPhones("Мой номер 8 999 123-45-67, звоните после 18"),
		).toEqual(["+79991234567"]);
	});

	test("не принимает даты, суммы и карты за телефон", () => {
		expect(
			extractPhones(
				"Оплатила 12.09.2026 сумму 15 000, карта 2200 1234 5678 9012",
			),
		).toEqual([]);
	});

	test("убирает повторы одного номера в разной записи", () => {
		expect(extractPhones("+79991234567 или 8(999)1234567")).toEqual([
			"+79991234567",
		]);
	});
});

test("samePhone сравнивает по нормализованной форме", () => {
	expect(samePhone("8 999 123-45-67", "+79991234567")).toBe(true);
	expect(samePhone("+79991234567", "+79991234568")).toBe(false);
});

test("formatPhone форматирует российский номер", () => {
	expect(formatPhone("+79991234567")).toBe("+7 999 123-45-67");
	expect(formatPhone("+375291234567")).toBe("+375291234567");
});
