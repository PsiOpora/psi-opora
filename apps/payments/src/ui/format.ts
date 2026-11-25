/** Форматирование для экранов: рубли/копейки и даты по Москве. */

export function rub(kopecks: number): string {
	return `${(kopecks / 100).toLocaleString("ru-RU", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})} ₽`;
}

/** «12 500,50» / «12500.5» → копейки; null — не число с копейками. */
export function parseRubles(input: string): number | null {
	const normalized = input.replace(/[\s ]/g, "").replace(",", ".");
	if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
	return Math.round(Number(normalized) * 100);
}

export function dateTime(date: Date | null | undefined): string {
	if (!date) return "—";
	return date.toLocaleString("ru-RU", {
		timeZone: "Europe/Moscow",
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function date(date: Date | null | undefined): string {
	if (!date) return "—";
	return date.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });
}

export const PURCHASE_STATUS: Record<string, string> = {
	pending: "Ждёт оплаты",
	paid: "Оплачено",
	refunded: "Возврат",
	cancelled: "Отменено",
};

export const MATCH_STATUS: Record<string, string> = {
	matched: "Привязана",
	manual: "Привязана вручную",
	unmatched: "Не разобрана",
	ignored: "Не оплата клиента",
};

export const SOURCE: Record<string, string> = {
	tbank_acquiring: "Эквайринг",
	tbank_account: "Перевод на счёт",
};

export const KIND: Record<string, string> = {
	package: "Пакет",
	course: "Курс",
};
