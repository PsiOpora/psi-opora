import { isValidEmail, normalizeEmail } from "@psi-opora/api/schemas";

/**
 * Разбор файлов контактов для импорта в email-списки. Работает в браузере:
 * файл не уходит на сервер целиком, на сервер отправляются только
 * разобранные пары email/имя пачками (там они проверяются повторно).
 */

/**
 * Декодирует байты файла. Excel в русской локали сохраняет «CSV (разделители
 * — запятые)» в Windows-1251, а Google Таблицы и LibreOffice — в UTF-8,
 * поэтому сначала пробуем строгий UTF-8, а при ошибке — Windows-1251.
 */
export function decodeCsvBytes(bytes: Uint8Array): {
	text: string;
	encoding: "utf-8" | "windows-1251";
} {
	try {
		const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		return { text: text.replace(/^﻿/, ""), encoding: "utf-8" };
	} catch {
		return {
			text: new TextDecoder("windows-1251").decode(bytes),
			encoding: "windows-1251",
		};
	}
}

const DELIMITERS = [",", ";", "\t", "|"] as const;
export type CsvDelimiter = (typeof DELIMITERS)[number];

/** Число разделителей в строке вне кавычек. */
function countOutsideQuotes(line: string, delimiter: string): number {
	let count = 0;
	let quoted = false;
	for (const ch of line) {
		if (ch === '"') quoted = !quoted;
		else if (ch === delimiter && !quoted) count++;
	}
	return count;
}

/**
 * Разделитель — тот, что встречается в первых строках одинаковое ненулевое
 * число раз (признак табличной структуры). Если такого нет — самый частый,
 * а для файла из одной колонки — запятая.
 */
export function detectDelimiter(text: string): CsvDelimiter {
	const lines = text
		.split(/\r?\n/)
		.filter((l) => l.trim())
		.slice(0, 20);
	let best: CsvDelimiter = ",";
	let bestScore = 0;
	for (const delimiter of DELIMITERS) {
		const counts = lines.map((l) => countOutsideQuotes(l, delimiter));
		const first = counts[0] ?? 0;
		if (first === 0) continue;
		const consistent = counts.filter((c) => c === first).length;
		const score = consistent * 1000 + first;
		if (score > bestScore) {
			bestScore = score;
			best = delimiter;
		}
	}
	return best;
}

/**
 * Парсер CSV по RFC 4180: значения в кавычках могут содержать разделитель,
 * перевод строки и экранированные кавычки (""). Пустые строки пропускаются.
 */
export function parseCsv(text: string, delimiter: CsvDelimiter): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;

	const pushRow = () => {
		row.push(field);
		field = "";
		if (row.some((cell) => cell.trim() !== "")) rows.push(row);
		row = [];
	};

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quoted) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					quoted = false;
				}
			} else {
				field += ch;
			}
			continue;
		}
		if (ch === '"' && field.trim() === "") {
			field = "";
			quoted = true;
		} else if (ch === delimiter) {
			row.push(field);
			field = "";
		} else if (ch === "\n") {
			pushRow();
		} else if (ch === "\r") {
			if (text[i + 1] !== "\n") pushRow();
		} else {
			field += ch;
		}
	}
	if (field !== "" || row.length > 0) pushRow();
	return rows.map((r) => r.map((cell) => cell.trim()));
}

const EMAIL_HEADER_RE =
	/^(e-?mail|email|почта|эл\.?\s*почта|электронная почта|адрес эл)/i;
const NAME_HEADER_RE =
	/^(имя|name|фио|full\s*name|first\s*name|контакт|клиент|получатель)/i;

export interface ColumnGuess {
	hasHeader: boolean;
	emailColumn: number | null;
	nameColumn: number | null;
}

/** Доля ячеек колонки (без первой строки), похожих на email. */
function emailShare(rows: string[][], column: number): number {
	const sample = rows.slice(1, 201);
	if (sample.length === 0) return 0;
	const hits = sample.filter((r) =>
		isValidEmail(normalizeEmail(r[column] ?? "")),
	).length;
	return hits / sample.length;
}

/**
 * Угадывает колонки email и имени по заголовку, а email — ещё и по
 * содержимому (колонка, где больше всего адресов). Первая строка считается
 * заголовком, если в колонке email в ней не адрес.
 */
export function guessColumns(rows: string[][]): ColumnGuess {
	const first = rows[0] ?? [];
	const width = Math.max(0, ...rows.slice(0, 50).map((r) => r.length));

	let emailColumn: number | null = null;
	first.forEach((cell, i) => {
		if (emailColumn === null && EMAIL_HEADER_RE.test(cell.trim()))
			emailColumn = i;
	});
	if (emailColumn === null) {
		let bestShare = 0;
		for (let i = 0; i < width; i++) {
			const share = Math.max(
				emailShare(rows, i),
				isValidEmail(normalizeEmail(first[i] ?? "")) ? 0.01 : 0,
			);
			if (share > bestShare) {
				bestShare = share;
				emailColumn = i;
			}
		}
	}

	const hasHeader =
		emailColumn !== null &&
		!isValidEmail(normalizeEmail(first[emailColumn] ?? ""));

	let nameColumn: number | null = null;
	if (hasHeader) {
		first.forEach((cell, i) => {
			if (
				nameColumn === null &&
				i !== emailColumn &&
				NAME_HEADER_RE.test(cell.trim())
			)
				nameColumn = i;
		});
	}

	return { hasHeader, emailColumn, nameColumn };
}

export interface ExtractedContact {
	email: string;
	name?: string;
}

export interface ExtractionResult {
	contacts: ExtractedContact[];
	/** Исходные значения, которые не прошли проверку адреса. */
	invalid: string[];
	/** Сколько строк отброшено как повтор адреса внутри файла. */
	duplicates: number;
}

/** Собирает контакты из разобранной таблицы по выбранным колонкам. */
export function extractContacts(
	rows: string[][],
	options: {
		hasHeader: boolean;
		emailColumn: number;
		nameColumn: number | null;
	},
): ExtractionResult {
	const seen = new Set<string>();
	const result: ExtractionResult = { contacts: [], invalid: [], duplicates: 0 };
	for (const row of options.hasHeader ? rows.slice(1) : rows) {
		const raw = row[options.emailColumn] ?? "";
		const email = normalizeEmail(raw);
		if (!email) continue;
		if (!isValidEmail(email)) {
			result.invalid.push(raw);
			continue;
		}
		if (seen.has(email)) {
			result.duplicates++;
			continue;
		}
		seen.add(email);
		const name =
			options.nameColumn === null ? "" : (row[options.nameColumn] ?? "").trim();
		result.contacts.push(name ? { email, name } : { email });
	}
	return result;
}

const EMAIL_TOKEN_RE = /[^\s<>,;:"'()[\]]+@[^\s<>,;:"'()[\]]+/g;

/**
 * Разбор вставленного текста: по одному контакту в строке в любом из
 * видов «email», «email, Имя», «Имя <email>», «Имя;email», либо просто
 * адреса через запятую/пробел. Всё, кроме адреса, в строке — имя.
 */
export function extractContactsFromText(text: string): ExtractionResult {
	const seen = new Set<string>();
	const result: ExtractionResult = { contacts: [], invalid: [], duplicates: 0 };
	for (const line of text.split(/\r?\n/)) {
		const tokens = line.match(EMAIL_TOKEN_RE) ?? [];
		if (tokens.length === 0) {
			if (line.includes("@")) result.invalid.push(line.trim());
			continue;
		}
		// Одна строка — один контакт с именем; несколько адресов — без имён.
		const name =
			tokens.length === 1
				? line
						.replace(tokens[0] as string, "")
						.replace(/[<>,;:"'()[\]\t]+/g, " ")
						.replace(/\s+/g, " ")
						.trim()
				: "";
		for (const token of tokens) {
			const email = normalizeEmail(token.replace(/^mailto:/i, ""));
			if (!isValidEmail(email)) {
				result.invalid.push(token);
				continue;
			}
			if (seen.has(email)) {
				result.duplicates++;
				continue;
			}
			seen.add(email);
			result.contacts.push(name ? { email, name } : { email });
		}
	}
	return result;
}

/** Экранирует значение для CSV-выгрузки (и от формульных инъекций Excel). */
export function toCsvCell(value: unknown): string {
	let text = value === null || value === undefined ? "" : String(value);
	if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
	return /[",;\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Скачивает CSV (UTF-8 с BOM, разделитель ";" — так его открывает русский Excel). */
export function downloadCsv(
	fileName: string,
	headers: string[],
	rows: unknown[][],
): void {
	const csv = [headers, ...rows]
		.map((r) => r.map(toCsvCell).join(";"))
		.join("\r\n");
	const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = fileName;
	link.click();
	URL.revokeObjectURL(url);
}
