/**
 * Разбор текста сообщения на фрагменты — отдельно от React, чтобы его можно
 * было проверить тестами. Разметка — «легаси» Markdown Telegram, которым
 * реально отправляются сообщения оператора: *жирный*, _курсив_, `код`,
 * [текст](ссылка). Её разбираем только у наших исходящих: у входящих сообщений
 * клиентов звёздочки и подчёркивания — обычный текст ("2*3*4"), а не разметка.
 * Кликабельными делаем только http(s)-ссылки.
 */

export type RichToken =
	| { type: "text"; text: string }
	| { type: "link"; text: string; href: string }
	| { type: "code" | "bold" | "italic"; text: string };

const LINK = String.raw`\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)`;
const BARE_URL = String.raw`(https?:\/\/[^\s<>()]*[^\s<>().,;:!?"'»])`;
const CODE = String.raw`\x60([^\x60\n]+)\x60`;
const BOLD = String.raw`(?<![\w*])\*([^*\n]+)\*(?![\w*])`;
const ITALIC = String.raw`(?<![\w_])_([^_\n]+)_(?![\w_])`;

const MARKUP_RE = new RegExp(
	`${LINK}|${BARE_URL}|${CODE}|${BOLD}|${ITALIC}`,
	"gu",
);
const PLAIN_RE = new RegExp(`${LINK}|${BARE_URL}`, "gu");

export function parseRichText(text: string, markup: boolean): RichToken[] {
	const re = markup ? MARKUP_RE : PLAIN_RE;
	const tokens: RichToken[] = [];
	let cursor = 0;

	for (const match of text.matchAll(re)) {
		const start = match.index ?? 0;
		if (start > cursor) {
			tokens.push({ type: "text", text: text.slice(cursor, start) });
		}
		const [, linkLabel, linkHref, bareUrl, code, bold, italic] = match;
		if (linkLabel && linkHref) {
			tokens.push({ type: "link", text: linkLabel, href: linkHref });
		} else if (bareUrl) {
			tokens.push({ type: "link", text: bareUrl, href: bareUrl });
		} else if (code) {
			tokens.push({ type: "code", text: code });
		} else if (bold) {
			tokens.push({ type: "bold", text: bold });
		} else if (italic) {
			tokens.push({ type: "italic", text: italic });
		}
		cursor = start + match[0].length;
	}
	if (cursor < text.length) {
		tokens.push({ type: "text", text: text.slice(cursor) });
	}
	return tokens;
}
