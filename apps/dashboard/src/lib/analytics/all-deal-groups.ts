import { type DealGroupStats, groupDealsBy } from "@psi-opora/db/queries";
import type { DateRange } from "./types";

const DEAL_GROUP_PAGE_SIZE = 1000;

/**
 * Все группы groupDealsBy("utmCampaign", ...) за период без пагинации —
 * используется там, где нужен полный join по разрезу (обогащение
 * бот-воронки и отчёта атрибуции расходом/выручкой), а не постраничная
 * таблица на UI (там пагинация остаётся на сервере, см. deals/report/route.ts).
 */
export async function fetchAllDealGroups(
	range: DateRange,
): Promise<DealGroupStats[]> {
	const options = { from: range.from, to: range.to };
	const firstPage = await groupDealsBy("utmCampaign", {
		...options,
		limit: DEAL_GROUP_PAGE_SIZE,
	});
	if (firstPage.rows.length >= firstPage.total) return firstPage.rows;

	const allGroups = await groupDealsBy("utmCampaign", {
		...options,
		limit: firstPage.total,
	});
	return allGroups.rows;
}
