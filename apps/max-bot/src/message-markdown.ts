/**
 * Восстановление markdown-разметки сообщения MAX из `body.text` + `body.markup`.
 *
 * MAX хранит текст без служебных символов, а форматирование — отдельным
 * списком диапазонов. Метод правки сообщения принимает только текст (с
 * `format: "markdown"`), поэтому чтобы убрать кнопки у уже отправленного
 * сообщения, не потеряв ссылки и выделение, собираем markdown обратно.
 */
export type MaxMarkupElement = {
	type: string;
	from: number;
	length: number;
	url?: string | null;
};

type Insert = { pos: number; text: string; order: number };

const WRAPPERS: Record<string, string> = {
	strong: "**",
	emphasized: "*",
	strikethrough: "~~",
};

function escapeMarkdown(text: string): string {
	return text.replace(/[\\`*_[\]()#+>~^]/g, "\\$&");
}

export function maxTextToMarkdown(
	text: string,
	markup: readonly MaxMarkupElement[] | null | undefined,
): string {
	if (!markup?.length) return escapeMarkdown(text);

	const inserts: Insert[] = [];
	let order = 0;
	for (const el of markup) {
		const end = el.from + el.length;
		if (
			!Number.isInteger(el.from) ||
			!Number.isInteger(el.length) ||
			el.from < 0 ||
			el.length <= 0 ||
			end > text.length
		) {
			continue;
		}
		const wrapper = WRAPPERS[el.type];
		if (wrapper) {
			inserts.push({ pos: el.from, text: wrapper, order: order++ });
			inserts.push({ pos: end, text: wrapper, order: order++ });
		} else if (el.type === "link" && el.url) {
			inserts.push({ pos: el.from, text: "[", order: order++ });
			inserts.push({ pos: end, text: `](${el.url})`, order: order++ });
		}
	}

	// Разбиваем исходный текст до экранирования: позиции MAX остаются исходными.
	inserts.sort((a, b) => a.pos - b.pos || a.order - b.order);
	let result = "";
	let cursor = 0;
	for (const insert of inserts) {
		result += escapeMarkdown(text.slice(cursor, insert.pos)) + insert.text;
		cursor = insert.pos;
	}
	return result + escapeMarkdown(text.slice(cursor));
}
