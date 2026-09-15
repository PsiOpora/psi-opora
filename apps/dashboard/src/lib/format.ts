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
