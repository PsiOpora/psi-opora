import { expect, test } from "bun:test";
import { parseRubles, rub } from "../src/ui/format";

test("parseRubles: пробелы, запятая, копейки", () => {
	expect(parseRubles("12 500,50")).toBe(1_250_050);
	expect(parseRubles("12500.5")).toBe(1_250_050);
	expect(parseRubles("1980")).toBe(198_000);
	expect(parseRubles("0,07")).toBe(7);
});

test("parseRubles: мусор и отрицательные — null", () => {
	expect(parseRubles("")).toBeNull();
	expect(parseRubles("abc")).toBeNull();
	expect(parseRubles("-5")).toBeNull();
	expect(parseRubles("1,234")).toBeNull();
});

test("rub форматирует копейки в рубли", () => {
	expect(rub(198_000).replace(/\s/g, "")).toBe("1980,00₽");
});
