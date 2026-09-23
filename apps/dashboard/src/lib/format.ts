const moneyFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(value: number, currency = "RUB"): string {
	const normalizedCurrency = currency.trim().toUpperCase() || "RUB";
	let formatter = moneyFormatters.get(normalizedCurrency);

	if (!formatter) {
		try {
			const maximumFractionDigits = new Intl.NumberFormat("ru-RU", {
				style: "currency",
				currency: normalizedCurrency,
			}).resolvedOptions().maximumFractionDigits;
			formatter = new Intl.NumberFormat("ru-RU", {
				style: "currency",
				currency: normalizedCurrency,
				minimumFractionDigits: 0,
				maximumFractionDigits,
			});
		} catch {
			formatter = new Intl.NumberFormat("ru-RU", {
				style: "currency",
				currency: "RUB",
				minimumFractionDigits: 0,
				maximumFractionDigits: 2,
			});
		}
		moneyFormatters.set(normalizedCurrency, formatter);
	}

	return formatter.format(value);
}

export function formatPercent(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}

export function formatNumber(value: number): string {
	return value.toLocaleString("ru-RU");
}

const dayMonthFormatter = new Intl.DateTimeFormat("ru-RU", {
	day: "numeric",
	month: "long",
});

/**
 * Человекочитаемый период: «5 сентября 2026», «1–30 сентября 2026»,
 * «24 августа – 23 сентября 2026», «1 декабря 2025 – 5 января 2026».
 */
export function formatDateRange(from: Date, to: Date): string {
	const fromYear = from.getFullYear();
	const toYear = to.getFullYear();
	const sameYear = fromYear === toYear;
	const sameMonth = sameYear && from.getMonth() === to.getMonth();

	if (sameMonth && from.getDate() === to.getDate()) {
		return `${dayMonthFormatter.format(to)} ${toYear}`;
	}
	if (sameMonth) {
		return `${from.getDate()}–${dayMonthFormatter.format(to)} ${toYear}`;
	}
	const fromLabel = sameYear
		? dayMonthFormatter.format(from)
		: `${dayMonthFormatter.format(from)} ${fromYear}`;
	return `${fromLabel} – ${dayMonthFormatter.format(to)} ${toYear}`;
}
