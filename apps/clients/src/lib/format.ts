import { format, isThisYear, isToday, isYesterday } from "date-fns";
import { ru } from "date-fns/locale";

/** Компактное время для списка диалогов: сегодня — 14:05, в этом году — 7 июл, иначе — 07.07.24. */
export function formatListTime(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	if (isToday(date)) return format(date, "HH:mm");
	if (isThisYear(date)) return format(date, "d MMM", { locale: ru });
	return format(date, "dd.MM.yy");
}

/** Заголовок-разделитель дня в переписке. */
export function formatDayLabel(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	if (isToday(date)) return "Сегодня";
	if (isYesterday(date)) return "Вчера";
	return format(date, "d MMMM yyyy", { locale: ru });
}

export function formatTime(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	return format(date, "HH:mm");
}

export function formatFullDate(iso: string | null): string {
	if (!iso) return "—";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "—";
	return format(date, "d MMMM yyyy, HH:mm", { locale: ru });
}
