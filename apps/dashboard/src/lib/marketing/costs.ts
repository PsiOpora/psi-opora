/** Месяц YYYY-MM пересекается с периодом? */
export function monthIntersectsRange(
	month: string,
	from: Date,
	to: Date,
): boolean {
	const [year, monthIndex] = month.split("-").map(Number);
	if (!year || !monthIndex) return false;
	const monthStart = new Date(year, monthIndex - 1, 1);
	const monthEnd = new Date(year, monthIndex, 0, 23, 59, 59, 999);
	return monthStart <= to && monthEnd >= from;
}
