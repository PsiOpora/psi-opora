import { describe, expect, test } from "bun:test";
import { parseRichText } from "./rich-text-parse";
import { applyTemplateVariables } from "./template-variables";

describe("parseRichText", () => {
	test("разбирает разметку оператора", () => {
		expect(
			parseRichText("Привет *мир*, _курсив_ и `код`", true).map((t) => t.type),
		).toEqual(["text", "bold", "text", "italic", "text", "code"]);
	});

	test("у входящих разметку не трогает, но ссылки кликабельны", () => {
		const tokens = parseRichText("2*3*4 см. https://example.com/a_b_c.", false);
		expect(tokens).toEqual([
			{ type: "text", text: "2*3*4 см. " },
			{
				type: "link",
				text: "https://example.com/a_b_c",
				href: "https://example.com/a_b_c",
			},
			{ type: "text", text: "." },
		]);
	});

	test("ссылка в скобках с подписью; подчёркивания в URL не становятся курсивом", () => {
		const tokens = parseRichText(
			"[карта](https://maps.example.com/x_y_z) и snake_case_word",
			true,
		);
		expect(tokens[0]).toEqual({
			type: "link",
			text: "карта",
			href: "https://maps.example.com/x_y_z",
		});
		expect(tokens.some((t) => t.type === "italic")).toBe(false);
	});

	test("не создаёт ссылок с опасными схемами", () => {
		const tokens = parseRichText("[клик](javascript:alert(1))", true);
		expect(tokens.some((t) => t.type === "link")).toBe(false);
	});
});

describe("applyTemplateVariables", () => {
	test("подставляет имя клиента", () => {
		expect(applyTemplateVariables("Здравствуйте, {имя}!", "Анна Иванова")).toBe(
			"Здравствуйте, Анна!",
		);
	});

	test("без имени убирает переменную вместе с запятой", () => {
		expect(applyTemplateVariables("Здравствуйте, {имя}!", "  ")).toBe(
			"Здравствуйте!",
		);
	});
});
