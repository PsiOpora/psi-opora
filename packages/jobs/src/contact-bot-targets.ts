import type { Messenger } from "./messenger";

export interface ContactIm {
	VALUE?: string;
	VALUE_TYPE?: string;
}

export interface DirectBotTarget {
	messenger: Messenger;
	userId: string;
}

function messengerFromImType(raw: unknown): Messenger | null {
	const type = String(raw ?? "")
		.trim()
		.toLowerCase();
	if (type.includes("telegram")) return "telegram";
	if (type === "max" || type.endsWith("|max") || type.includes("max.ru")) {
		return "max";
	}
	return null;
}

/**
 * Все пользователи наших ботов (Telegram/MAX) из IM-поля контакта Bitrix в
 * порядке полей контакта. VALUE должен быть числовым ID пользователя, а не
 * ID чата Открытой линии — такие записи пропускаются.
 */
export function listContactBotTargets(
	contact: { IM?: ContactIm[] } | false,
): DirectBotTarget[] {
	return (contact ? (contact.IM ?? []) : [])
		.map((entry): DirectBotTarget | null => {
			const messenger = messengerFromImType(entry.VALUE_TYPE);
			const userId = String(entry.VALUE ?? "").trim();
			return messenger && /^\d+$/.test(userId) ? { messenger, userId } : null;
		})
		.filter((target): target is DirectBotTarget => target !== null);
}
