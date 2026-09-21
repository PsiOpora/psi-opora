"use client";

import { useQuery } from "@tanstack/react-query";
import type {
	AttributionRow,
	AttributionSummary,
} from "@/lib/analytics/attribution";
import { formatDateParam } from "@/lib/analytics/date-range";
import type { DateRange } from "@/lib/analytics/types";

export function useAttributionReport(range: DateRange) {
	return useQuery({
		queryKey: [
			"dashboard-attribution",
			formatDateParam(range.from),
			formatDateParam(range.to),
		],
		queryFn: async () => {
			const params = new URLSearchParams({
				from: formatDateParam(range.from),
				to: formatDateParam(range.to),
			});
			const res = await fetch(`/api/dashboard/attribution?${params}`);
			if (!res.ok) throw new Error("Не удалось загрузить отчёт атрибуции");
			return (await res.json()) as {
				rows: AttributionRow[];
				summary: AttributionSummary;
			};
		},
	});
}
