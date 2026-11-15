/**
 * Минимальная выгрузка таблицы в настоящий .xlsx без внешних библиотек: книга
 * из одного листа, первая строка — жирные заголовки (закреплена), ширина
 * колонок по содержимому. Файл — ZIP без сжатия (method 0): для отчётов в
 * тысячи строк размер не критичен, а своего inflate/deflate писать не нужно.
 *
 * Строки пишутся как inline-строки, поэтому телефоны вида «+7999…» и значения,
 * начинающиеся с «=», остаются текстом (формул и потери нулей нет).
 */

export type XlsxCell = string | number | boolean | null | undefined;

const encoder = new TextEncoder();

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

export function crc32(data: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of data) {
		crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

/** Лимит Excel на длину текста в одной ячейке. */
const MAX_CELL_LENGTH = 32767;
/** Недопустимые в XML 1.0 управляющие символы (кроме \t \n \r). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: именно их и вычищаем
const INVALID_XML_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

export function escapeXml(text: string): string {
	return text
		.replace(INVALID_XML_CHARS, "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Номер колонки (0 → A, 25 → Z, 26 → AA). */
export function columnName(index: number): string {
	let name = "";
	let n = index;
	do {
		name = String.fromCharCode(65 + (n % 26)) + name;
		n = Math.floor(n / 26) - 1;
	} while (n >= 0);
	return name;
}

/** Имя листа: до 31 символа, без []:*?/\ — иначе Excel «чинит» файл. */
export function safeSheetName(name: string): string {
	const cleaned = name.replace(/[[\]:*?/\\]/g, " ").trim();
	return cleaned.slice(0, 31) || "Отчёт";
}

function cellXml(ref: string, value: XlsxCell, header: boolean): string {
	if (value === null || value === undefined || value === "") return "";
	if (typeof value === "number" && Number.isFinite(value)) {
		return `<c r="${ref}"><v>${value}</v></c>`;
	}
	if (typeof value === "boolean") {
		return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
	}
	const text = escapeXml(String(value).slice(0, MAX_CELL_LENGTH));
	const style = header ? ' s="1"' : "";
	return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${text}</t></is></c>`;
}

function sheetXml(headers: string[], rows: XlsxCell[][]): string {
	const all: XlsxCell[][] = [headers, ...rows];
	const widths = headers.map((_, col) => {
		let longest = 0;
		// Ширину считаем по первым строкам — этого хватает, а на длинных
		// отчётах не тратим время на каждую ячейку.
		for (const row of all.slice(0, 200)) {
			const text = row[col] == null ? "" : String(row[col]);
			longest = Math.max(
				longest,
				...text.split("\n").map((line) => line.length),
			);
		}
		return Math.min(60, Math.max(10, longest + 2));
	});

	const cols = widths
		.map(
			(w, i) =>
				`<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`,
		)
		.join("");
	const body = all
		.map((row, r) => {
			const cells = row
				.map((value, c) => cellXml(`${columnName(c)}${r + 1}`, value, r === 0))
				.join("");
			return `<row r="${r + 1}">${cells}</row>`;
		})
		.join("");

	return (
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
		'<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
		`<cols>${cols}</cols><sheetData>${body}</sheetData></worksheet>`
	);
}

const STYLES_XML =
	'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
	'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
	'<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
	'<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
	'<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
	'<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
	'<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
	"</styleSheet>";

const CONTENT_TYPES_XML =
	'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
	'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
	'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
	'<Default Extension="xml" ContentType="application/xml"/>' +
	'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
	'<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
	'<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
	"</Types>";

const ROOT_RELS_XML =
	'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
	'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
	'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
	"</Relationships>";

const WORKBOOK_RELS_XML =
	'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
	'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
	'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
	'<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
	"</Relationships>";

function workbookXml(sheetName: string): string {
	return (
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
		`<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`
	);
}

interface ZipEntry {
	name: string;
	data: Uint8Array;
}

/** ZIP без сжатия: локальные заголовки + центральный каталог + EOCD. */
export function zipStore(entries: ZipEntry[]): Uint8Array {
	const parts: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;

	// 2025-01-01 00:00 — ZIP требует время, содержимое от него не зависит.
	const dosTime = 0;
	const dosDate = ((2025 - 1980) << 9) | (1 << 5) | 1;

	for (const entry of entries) {
		const name = encoder.encode(entry.name);
		const crc = crc32(entry.data);
		const size = entry.data.length;

		const local = new Uint8Array(30 + name.length);
		const lv = new DataView(local.buffer);
		lv.setUint32(0, 0x04034b50, true);
		lv.setUint16(4, 20, true);
		lv.setUint16(6, 0x0800, true); // имена в UTF-8
		lv.setUint16(8, 0, true); // без сжатия
		lv.setUint16(10, dosTime, true);
		lv.setUint16(12, dosDate, true);
		lv.setUint32(14, crc, true);
		lv.setUint32(18, size, true);
		lv.setUint32(22, size, true);
		lv.setUint16(26, name.length, true);
		lv.setUint16(28, 0, true);
		local.set(name, 30);

		const dir = new Uint8Array(46 + name.length);
		const dv = new DataView(dir.buffer);
		dv.setUint32(0, 0x02014b50, true);
		dv.setUint16(4, 20, true);
		dv.setUint16(6, 20, true);
		dv.setUint16(8, 0x0800, true);
		dv.setUint16(10, 0, true);
		dv.setUint16(12, dosTime, true);
		dv.setUint16(14, dosDate, true);
		dv.setUint32(16, crc, true);
		dv.setUint32(20, size, true);
		dv.setUint32(24, size, true);
		dv.setUint16(28, name.length, true);
		dv.setUint32(42, offset, true);
		dir.set(name, 46);

		parts.push(local, entry.data);
		central.push(dir);
		offset += local.length + size;
	}

	const centralSize = central.reduce((sum, c) => sum + c.length, 0);
	const end = new Uint8Array(22);
	const ev = new DataView(end.buffer);
	ev.setUint32(0, 0x06054b50, true);
	ev.setUint16(8, entries.length, true);
	ev.setUint16(10, entries.length, true);
	ev.setUint32(12, centralSize, true);
	ev.setUint32(16, offset, true);

	const all = [...parts, ...central, end];
	const out = new Uint8Array(all.reduce((sum, p) => sum + p.length, 0));
	let pos = 0;
	for (const part of all) {
		out.set(part, pos);
		pos += part.length;
	}
	return out;
}

/** Собирает .xlsx (один лист) в виде байтов. */
export function buildXlsx(
	headers: string[],
	rows: XlsxCell[][],
	sheetName = "Отчёт",
): Uint8Array {
	const file = (name: string, xml: string): ZipEntry => ({
		name,
		data: encoder.encode(xml),
	});
	return zipStore([
		file("[Content_Types].xml", CONTENT_TYPES_XML),
		file("_rels/.rels", ROOT_RELS_XML),
		file("xl/workbook.xml", workbookXml(safeSheetName(sheetName))),
		file("xl/_rels/workbook.xml.rels", WORKBOOK_RELS_XML),
		file("xl/styles.xml", STYLES_XML),
		file("xl/worksheets/sheet1.xml", sheetXml(headers, rows)),
	]);
}

export const XLSX_MIME =
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Скачивает отчёт как .xlsx (имя файла без расширения тоже допустимо). */
export function downloadXlsx(
	fileName: string,
	headers: string[],
	rows: XlsxCell[][],
	sheetName?: string,
): void {
	const name = fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`;
	const bytes = buildXlsx(headers, rows, sheetName);
	const url = URL.createObjectURL(
		new Blob([bytes as Uint8Array<ArrayBuffer>], { type: XLSX_MIME }),
	);
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	link.click();
	URL.revokeObjectURL(url);
}
