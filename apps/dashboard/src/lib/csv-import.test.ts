import { describe, expect, test } from "bun:test";
import {
	decodeCsvBytes,
	detectDelimiter,
	extractContacts,
	extractContactsFromText,
	guessColumns,
	parseCsv,
	toCsvCell,
} from "./csv-import";

describe("decodeCsvBytes", () => {
	test("UTF-8 с BOM", () => {
		const bytes = new Uint8Array([
			0xef,
			0xbb,
			0xbf,
			...new TextEncoder().encode("Имя"),
		]);
		expect(decodeCsvBytes(bytes)).toEqual({ text: "Имя", encoding: "utf-8" });
	});

	test("Windows-1251 из русского Excel", () => {
		// «Имя» в cp1251
		const bytes = new Uint8Array([0xc8, 0xec, 0xff]);
		expect(decodeCsvBytes(bytes)).toEqual({
			text: "Имя",
			encoding: "windows-1251",
		});
	});
});

describe("detectDelimiter", () => {
	test("точка с запятой (русский Excel)", () => {
		expect(detectDelimiter("Имя;Email\nИван;ivan@mail.ru\n")).toBe(";");
	});

	test("запятая, игнорирует запятые в кавычках", () => {
		expect(detectDelimiter('name,email\n"Петров, Иван",ivan@mail.ru\n')).toBe(
			",",
		);
	});

	test("табуляция", () => {
		expect(detectDelimiter("a\tb\nc\td")).toBe("\t");
	});

	test("одна колонка — запятая по умолчанию", () => {
		expect(detectDelimiter("ivan@mail.ru\npetr@mail.ru")).toBe(",");
	});
});

describe("parseCsv", () => {
	test("кавычки, экранирование и перевод строки внутри значения", () => {
		const rows = parseCsv(
			'name,email\r\n"Петров, ""Иван""",ivan@mail.ru\r\n"многострочное\nимя",petr@mail.ru\r\n\r\n',
			",",
		);
		expect(rows).toEqual([
			["name", "email"],
			['Петров, "Иван"', "ivan@mail.ru"],
			["многострочное\nимя", "petr@mail.ru"],
		]);
	});

	test("последняя строка без перевода строки", () => {
		expect(parseCsv("a;b\nc;d", ";")).toEqual([
			["a", "b"],
			["c", "d"],
		]);
	});
});

describe("guessColumns", () => {
	test("находит колонки по заголовкам", () => {
		const rows = parseCsv("ФИО;Телефон;E-mail\nИван;+7900;ivan@mail.ru", ";");
		expect(guessColumns(rows)).toEqual({
			hasHeader: true,
			emailColumn: 2,
			phoneColumn: 1,
			nameColumn: 0,
		});
	});

	test("без заголовка — колонка email по содержимому", () => {
		const rows = parseCsv("Иван,ivan@mail.ru\nПётр,petr@mail.ru", ",");
		expect(guessColumns(rows)).toEqual({
			hasHeader: false,
			emailColumn: 1,
			phoneColumn: null,
			nameColumn: null,
		});
	});

	test("только телефоны — колонка телефона по содержимому", () => {
		const rows = parseCsv(
			"Имя;Контакт\nИван;8 999 123-45-67\nПётр;+79990000002",
			";",
		);
		expect(guessColumns(rows)).toEqual({
			hasHeader: true,
			emailColumn: null,
			phoneColumn: 1,
			nameColumn: 0,
		});
	});
});

describe("extractContacts с телефонами", () => {
	test("нормализует телефон, отбрасывает полные повторы, частичные отдаёт серверу", () => {
		const rows = [
			["Иван", "8 (999) 123-45-67", "ivan@mail.ru"],
			["Иван", "+7 999 123 45 67", "ivan@mail.ru"],
			["Иван", "79991234567", "ivan2@mail.ru"],
			["Без почты", "+79990000002", ""],
			["Плохой", "123", ""],
		];
		expect(
			extractContacts(rows, {
				hasHeader: false,
				emailColumn: 2,
				phoneColumn: 1,
				nameColumn: 0,
			}),
		).toEqual({
			contacts: [
				{ email: "ivan@mail.ru", phone: "+79991234567", name: "Иван" },
				{ email: "ivan2@mail.ru", phone: "+79991234567", name: "Иван" },
				{ phone: "+79990000002", name: "Без почты" },
			],
			invalid: ["123"],
			duplicates: 1,
		});
	});
});

describe("extractContacts", () => {
	test("нормализует, отбрасывает невалидные и дубли", () => {
		const rows = [
			["email", "name"],
			[" Ivan@Mail.ru ", "Иван"],
			["ivan@mail.ru", "Иван 2"],
			["broken@", "X"],
			["", "пусто"],
			["petr@mail.ru", ""],
		];
		expect(
			extractContacts(rows, { hasHeader: true, emailColumn: 0, nameColumn: 1 }),
		).toEqual({
			contacts: [
				{ email: "ivan@mail.ru", name: "Иван" },
				{ email: "petr@mail.ru" },
			],
			invalid: ["broken@"],
			duplicates: 1,
		});
	});
});

describe("extractContactsFromText", () => {
	test("телефон и email в одной строке — один контакт", () => {
		const result = extractContactsFromText(
			"Анна Иванова; +7 999 123-45-67; anna@mail.ru\n8 900 000 00 01",
		);
		expect(result.contacts).toEqual([
			{ email: "anna@mail.ru", phone: "+79991234567", name: "Анна Иванова" },
			{ phone: "+79000000001" },
		]);
	});

	test("разные форматы строк", () => {
		const result = extractContactsFromText(
			[
				"ivan@mail.ru",
				"Пётр Петров <petr@mail.ru>",
				"anna@mail.ru, Анна",
				"a@x.ru b@x.ru",
				"плохой@адрес",
				"просто текст",
				"IVAN@mail.ru",
			].join("\n"),
		);
		expect(result.contacts).toEqual([
			{ email: "ivan@mail.ru" },
			{ email: "petr@mail.ru", name: "Пётр Петров" },
			{ email: "anna@mail.ru", name: "Анна" },
			{ email: "a@x.ru" },
			{ email: "b@x.ru" },
		]);
		expect(result.invalid).toEqual(["плохой@адрес"]);
		expect(result.duplicates).toBe(1);
	});
});

describe("toCsvCell", () => {
	test("экранирует разделители и формулы", () => {
		expect(toCsvCell("a;b")).toBe('"a;b"');
		expect(toCsvCell('a"b')).toBe('"a""b"');
		expect(toCsvCell("=1+1")).toBe("'=1+1");
		expect(toCsvCell(null)).toBe("");
	});
});
