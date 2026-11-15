import { describe, expect, it } from "bun:test";
import {
	buildXlsx,
	columnName,
	crc32,
	escapeXml,
	safeSheetName,
} from "./xlsx-export";

/** Читает записи несжатого ZIP по центральному каталогу. */
function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const eocd = bytes.length - 22;
	expect(view.getUint32(eocd, true)).toBe(0x06054b50);
	const count = view.getUint16(eocd + 10, true);
	let pos = view.getUint32(eocd + 16, true);
	const decoder = new TextDecoder();
	const files = new Map<string, Uint8Array>();
	for (let i = 0; i < count; i++) {
		expect(view.getUint32(pos, true)).toBe(0x02014b50);
		const crc = view.getUint32(pos + 16, true);
		const size = view.getUint32(pos + 24, true);
		const nameLen = view.getUint16(pos + 28, true);
		const offset = view.getUint32(pos + 42, true);
		const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
		// Локальный заголовок: данные идут сразу за именем.
		expect(view.getUint32(offset, true)).toBe(0x04034b50);
		const localNameLen = view.getUint16(offset + 26, true);
		const start = offset + 30 + localNameLen;
		const data = bytes.subarray(start, start + size);
		expect(crc32(data)).toBe(crc);
		files.set(name, data);
		pos += 46 + nameLen;
	}
	return files;
}

describe("crc32", () => {
	it("совпадает со стандартным значением для «123456789»", () => {
		expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
	});
});

describe("columnName", () => {
	it("переводит индексы в буквы Excel", () => {
		expect(columnName(0)).toBe("A");
		expect(columnName(25)).toBe("Z");
		expect(columnName(26)).toBe("AA");
		expect(columnName(27)).toBe("AB");
		expect(columnName(701)).toBe("ZZ");
		expect(columnName(702)).toBe("AAA");
	});
});

describe("safeSheetName", () => {
	it("убирает запрещённые символы и режет до 31", () => {
		expect(safeSheetName("Отчёт: 1/2 [тест]")).toBe("Отчёт  1 2  тест");
		expect(safeSheetName("x".repeat(40))).toHaveLength(31);
		expect(safeSheetName("///")).toBe("Отчёт");
	});
});

describe("escapeXml", () => {
	it("экранирует разметку и вычищает управляющие символы", () => {
		expect(escapeXml('a<b>&"c"\u0000\u0007')).toBe(
			"a&lt;b&gt;&amp;&quot;c&quot;",
		);
		expect(escapeXml("строка\nс\tпереносом")).toBe("строка\nс\tпереносом");
	});
});

describe("buildXlsx", () => {
	const bytes = buildXlsx(
		["Имя", "Телефон", "Сумма"],
		[
			["Иван <Петров>", "+79991234567", 1500],
			["=SUM(A1)", null, 2.5],
		],
		"Получатели",
	);
	const files = readZip(bytes);
	const text = (name: string) => new TextDecoder().decode(files.get(name));

	it("содержит обязательные части книги", () => {
		expect([...files.keys()].sort()).toEqual([
			"[Content_Types].xml",
			"_rels/.rels",
			"xl/_rels/workbook.xml.rels",
			"xl/styles.xml",
			"xl/workbook.xml",
			"xl/worksheets/sheet1.xml",
		]);
		expect(text("xl/workbook.xml")).toContain('name="Получатели"');
	});

	it("пишет заголовки жирными, числа числами, текст строками", () => {
		const sheet = text("xl/worksheets/sheet1.xml");
		expect(sheet).toContain('<c r="A1" t="inlineStr" s="1">');
		expect(sheet).toContain("<v>1500</v>");
		expect(sheet).toContain("<v>2.5</v>");
		expect(sheet).toContain("Иван &lt;Петров&gt;");
		// Телефон остаётся текстом, не числом.
		expect(sheet).toContain(
			'<c r="B2" t="inlineStr"><is><t xml:space="preserve">+79991234567</t></is></c>',
		);
	});

	it("не превращает «=…» в формулу и пропускает пустые ячейки", () => {
		const sheet = text("xl/worksheets/sheet1.xml");
		expect(sheet).not.toContain("<f>");
		expect(sheet).toContain("=SUM(A1)");
		expect(sheet).not.toContain('r="B3"');
	});
});
