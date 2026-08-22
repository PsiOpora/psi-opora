"use client";

import { useQuery } from "@tanstack/react-query";
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
		queryKey: ["dashboard-deals-facets", range.from.toISOString(), range.to.toISOString()],
		queryFn: async () => {
			const params = new URLSearchParams({
				from: range.from.toISOString(),
				to: range.to.toISOString(),
			});
			const res = await fetch(`/api/dashboard/deals/facets?${params}`);
			if (!res.ok) throw new Error("Не удалось загрузить фильтры");
			return (await res.json()) as DealFacets;
		},
	});
}
