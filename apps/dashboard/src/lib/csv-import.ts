import {
	isValidEmail,
	normalizeEmail,
	normalizePhone,
} from "@psi-opora/api/schemas";

/**
 * Разбор файлов контактов для импорта в списки. Работает в браузере:
 * файл не уходит на сервер целиком, на сервер отправляются только
 * разобранные email/телефон/имя пачками (там они проверяются повторно и
 * склеиваются с уже существующими контактами без дублей).
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
const PHONE_HEADER_RE =
	/^(телефон|тел\.?|phone|mobile|моб|мобильный|номер|whatsapp|telegram|телеграм)/i;
const NAME_HEADER_RE =
	/^(имя|name|фио|full\s*name|first\s*name|контакт|клиент|получатель)/i;

export interface ColumnGuess {
	hasHeader: boolean;
	emailColumn: number | null;
	phoneColumn: number | null;
	nameColumn: number | null;
}

const isEmailCell = (cell: string) => isValidEmail(normalizeEmail(cell));
const isPhoneCell = (cell: string) => normalizePhone(cell) !== null;

/** Доля ячеек колонки (без первой строки), подходящих под проверку. */
function share(
	rows: string[][],
	column: number,
	matches: (cell: string) => boolean,
): number {
	const sample = rows.slice(1, 201);
	if (sample.length === 0) return 0;
	return sample.filter((r) => matches(r[column] ?? "")).length / sample.length;
}

/** Колонка, где больше всего подходящих значений (с подсказкой по первой строке). */
function bestColumn(
	rows: string[][],
	width: number,
	matches: (cell: string) => boolean,
	exclude: number | null,
): number | null {
	const first = rows[0] ?? [];
	let best: number | null = null;
	let bestShare = 0;
	for (let i = 0; i < width; i++) {
		if (i === exclude) continue;
		const value = Math.max(
			share(rows, i, matches),
			matches(first[i] ?? "") ? 0.01 : 0,
		);
		if (value > bestShare) {
			bestShare = value;
			best = i;
		}
	}
	return best;
}

/**
 * Угадывает колонки email, телефона и имени по заголовку, а email и
 * телефон — ещё и по содержимому. Первая строка считается заголовком, если
 * в найденной колонке email (или телефона, если email нет) — не адрес/номер.
 */
export function guessColumns(rows: string[][]): ColumnGuess {
	const first = rows[0] ?? [];
	const width = Math.max(0, ...rows.slice(0, 50).map((r) => r.length));
	const byHeader = (re: RegExp, exclude: Array<number | null>) => {
		const index = first.findIndex(
			(cell, i) => !exclude.includes(i) && re.test(cell.trim()),
		);
		return index < 0 ? null : index;
	};

	const emailColumn =
		byHeader(EMAIL_HEADER_RE, []) ?? bestColumn(rows, width, isEmailCell, null);
	const phoneColumn =
		byHeader(PHONE_HEADER_RE, [emailColumn]) ??
		bestColumn(rows, width, isPhoneCell, emailColumn);

	const hasHeader =
		emailColumn !== null
			? !isEmailCell(first[emailColumn] ?? "")
			: phoneColumn !== null && !isPhoneCell(first[phoneColumn] ?? "");

	const nameColumn = hasHeader
		? byHeader(NAME_HEADER_RE, [emailColumn, phoneColumn])
		: null;

	return { hasHeader, emailColumn, phoneColumn, nameColumn };
}

export interface ExtractedContact {
	email?: string;
	phone?: string;
	name?: string;
}

export interface ExtractionResult {
	contacts: ExtractedContact[];
	/** Исходные значения, которые не прошли проверку адреса/телефона. */
	invalid: string[];
	/** Сколько строк отброшено как повтор внутри файла. */
	duplicates: number;
}

/**
 * Копит контакты без повторов внутри файла: строка — повтор, если все её
 * email/телефон уже встречались. Частичные совпадения (тот же телефон с
 * новым email) уходят на сервер — он склеит их с контактом без дубля.
 */
class ContactCollector {
	private readonly emails = new Set<string>();
	private readonly phones = new Set<string>();
	readonly result: ExtractionResult = {
		contacts: [],
		invalid: [],
		duplicates: 0,
	};

	add(contact: { email: string | null; phone: string | null; name: string }) {
		const { email, phone, name } = contact;
		if (!email && !phone) return;
		const seen =
			(!email || this.emails.has(email)) && (!phone || this.phones.has(phone));
		if (seen) {
			this.result.duplicates++;
			return;
		}
		if (email) this.emails.add(email);
		if (phone) this.phones.add(phone);
		this.result.contacts.push({
			...(email ? { email } : {}),
			...(phone ? { phone } : {}),
			...(name ? { name } : {}),
		});
	}
}

/** Собирает контакты из разобранной таблицы по выбранным колонкам. */
export function extractContacts(
	rows: string[][],
	options: {
		hasHeader: boolean;
		emailColumn: number | null;
		phoneColumn?: number | null;
		nameColumn: number | null;
	},
): ExtractionResult {
	const collector = new ContactCollector();
	const phoneColumn = options.phoneColumn ?? null;
	for (const row of options.hasHeader ? rows.slice(1) : rows) {
		const rawEmail =
			options.emailColumn === null ? "" : (row[options.emailColumn] ?? "");
		const rawPhone =
			phoneColumn === null ? "" : (row[phoneColumn] ?? "").trim();
		const email = normalizeEmail(rawEmail);
		const emailOk = Boolean(email) && isValidEmail(email);
		const phone = rawPhone ? normalizePhone(rawPhone) : null;
		if (email && !emailOk) collector.result.invalid.push(rawEmail);
		if (rawPhone && !phone) collector.result.invalid.push(rawPhone);
		const name =
			options.nameColumn === null ? "" : (row[options.nameColumn] ?? "").trim();
		collector.add({ email: emailOk ? email : null, phone, name });
	}
	return collector.result;
}

const EMAIL_TOKEN_RE = /[^\s<>,;:"'()[\]]+@[^\s<>,;:"'()[\]]+/g;
/** Цифры с телефонными разделителями — как PHONE_IN_TEXT в api/schemas/phone.ts. */
const PHONE_TOKEN_RE = /\+?\d[\d\s().-]{8,}\d/g;

/**
 * Разбор вставленного текста: по одному контакту в строке в любом из
 * видов «email», «email, Имя», «Имя <email>», «Имя; телефон; email», либо
 * просто адреса/телефоны через запятую. Всё, кроме адреса и телефона, — имя.
 */
export function extractContactsFromText(text: string): ExtractionResult {
	const collector = new ContactCollector();
	for (const line of text.split(/\r?\n/)) {
		const emailTokens = line.match(EMAIL_TOKEN_RE) ?? [];
		// Цифры внутри адреса (ivan.79991234567@mail.ru) — не телефон.
		const withoutEmails = emailTokens.reduce(
			(rest, token) => rest.replace(token, " "),
			line,
		);
		const phoneTokens = withoutEmails.match(PHONE_TOKEN_RE) ?? [];
		if (emailTokens.length === 0 && phoneTokens.length === 0) {
			if (line.includes("@")) collector.result.invalid.push(line.trim());
			continue;
		}

		const emails: string[] = [];
		for (const token of emailTokens) {
			const email = normalizeEmail(token.replace(/^mailto:/i, ""));
			if (isValidEmail(email)) emails.push(email);
			else collector.result.invalid.push(token);
		}
		const phones: string[] = [];
		for (const token of phoneTokens) {
			const phone = normalizePhone(token);
			if (phone) phones.push(phone);
			else collector.result.invalid.push(token.trim());
		}

		// Один адрес и/или один телефон — один контакт с именем; несколько
		// адресов или телефонов в строке — по контакту на каждый, без имён.
		if (emailTokens.length <= 1 && phoneTokens.length <= 1) {
			const name = phoneTokens
				.reduce((rest, token) => rest.replace(token, " "), withoutEmails)
				.replace(/[<>,;:"'()[\]\t]+/g, " ")
				.replace(/\s+/g, " ")
				.trim();
			collector.add({
				email: emails[0] ?? null,
				phone: phones[0] ?? null,
				name,
			});
			continue;
		}
		for (const email of emails) collector.add({ email, phone: null, name: "" });
		for (const phone of phones) collector.add({ email: null, phone, name: "" });
	}
	return collector.result;
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
