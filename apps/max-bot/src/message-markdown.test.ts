import { describe, expect, test } from "bun:test";
import { maxTextToMarkdown } from "./message-markdown";

describe("maxTextToMarkdown", () => {
	test("без разметки возвращает текст как есть", () => {
		expect(maxTextToMarkdown("Привет", undefined)).toBe("Привет");
		expect(maxTextToMarkdown("Привет", [])).toBe("Привет");
	});

	test("ссылка и выделение", () => {
		const text = "Согласие: https://psi-opora.ru/x и важно";
		expect(
			maxTextToMarkdown(text, [
				{
					type: "link",
					from: 10,
					length: 22,
					url: "https://psi-opora.ru/x",
				},
				{ type: "strong", from: 35, length: 5 },
			]),
		).toBe(
			"Согласие: [https://psi-opora.ru/x](https://psi-opora.ru/x) и **важно**",
		);
	});

	test("смежные диапазоны не перемешиваются", () => {
		expect(
			maxTextToMarkdown("ab", [
				{ type: "strong", from: 0, length: 1 },
				{ type: "emphasized", from: 1, length: 1 },
			]),
		).toBe("**a***b*");
	});

	test("диапазон за пределами текста пропускается", () => {
		expect(
			maxTextToMarkdown("abc", [{ type: "strong", from: 2, length: 5 }]),
		).toBe("abc");
	});
});

test("literal markdown is escaped before, inside and after original UTF-16 ranges", () => {
	expect(
		maxTextToMarkdown("*😀a_b*", [{ type: "strong", from: 3, length: 3 }]),
	).toBe("\\*😀**a\\_b**\\*");
	expect(maxTextToMarkdown("_*[]()`~+^#>\\", null)).toBe(
		"\\_\\*\\[\\]\\(\\)\\`\\~\\+\\^\\#\\>\\\\",
	);
});
