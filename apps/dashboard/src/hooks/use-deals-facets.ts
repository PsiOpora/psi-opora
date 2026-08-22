"use client";

import { useQuery } from "@tanstack/react-query";
import { formatDateParam } from "@/lib/analytics/date-range";
import type { DateRange } from "@/lib/analytics/types";

export interface DealFacetOption {
	value: string;
	label: string;
	count: number;
}

export interface DealFacets {
	status: DealFacetOption[];
	categoryId: DealFacetOption[];
	sourceId: DealFacetOption[];
	utmSource: DealFacetOption[];
	utmMedium: DealFacetOption[];
	utmCampaign: DealFacetOption[];
}

/** Счётчики по значениям для фильтров конструктора отчётов — не зависят от
 * текущей группировки/фильтров, только от периода, поэтому кэшируются отдельно. */
export function useDealsFacets(range: DateRange) {
	return useQuery({
		queryKey: ["dashboard-deals-facets", formatDateParam(range.from), formatDateParam(range.to)],
		queryFn: async () => {
			const params = new URLSearchParams({
				from: formatDateParam(range.from),
				to: formatDateParam(range.to),
			});
			const res = await fetch(`/api/dashboard/deals/facets?${params}`);
			if (!res.ok) throw new Error("Не удалось загрузить фильтры");
			return (await res.json()) as DealFacets;
		},
	});
}
