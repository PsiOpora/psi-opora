import { describe, expect, test } from "bun:test";
import { isValidEmail, normalizeEmail } from "./email-lists";

describe("isValidEmail", () => {
	test.each([
		"user@example.com",
		"first.last+tag@sub.example.co.uk",
		"ivan_petrov@mail.ru",
		"info@пример.рф",
		"a@b.io",
	])("принимает %s", (email) => {
		expect(isValidEmail(email)).toBe(true);
	});

	test.each([
		"",
		"plainaddress",
		"@example.com",
		"user@",
		"user@example",
		"user@@example.com",
		"user name@example.com",
		"user@exa mple.com",
		"user..dots@example.com",
		".user@example.com",
		"user.@example.com",
		"user@-example.com",
		"user@example..com",
		"user@example.c",
		"user@example.com,other@example.com",
	])("отклоняет %p", (email) => {
		expect(isValidEmail(email)).toBe(false);
	});
});

describe("normalizeEmail", () => {
	test("обрезает пробелы и приводит к нижнему регистру", () => {
		expect(normalizeEmail("  Ivan.Petrov@Mail.RU \t")).toBe(
			"ivan.petrov@mail.ru",
		);
	});
});
