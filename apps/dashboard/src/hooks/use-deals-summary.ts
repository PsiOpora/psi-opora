"use client";

import type { DealsSummary, DealsTrendPoint } from "@psi-opora/db/queries";
import { useQuery } from "@tanstack/react-query";
import { formatDateParam } from "@/lib/analytics/date-range";
import type { DateRange } from "@/lib/analytics/types";
import type { DealsReportFilters } from "./use-deals-report";

const FILTER_PARAM_NAME: Record<keyof DealsReportFilters, string> = {
	status: "status",
	categoryId: "category",
	stageId: "stage",
	sourceId: "source",
	failReasonId: "failReason",
	utmSource: "utmSource",
	utmMedium: "utmMedium",
	utmCampaign: "utmCampaignFilter",
};

function appendFilters(params: URLSearchParams, filters: DealsReportFilters) {
	for (const [key, paramName] of Object.entries(FILTER_PARAM_NAME) as Array<
		[keyof DealsReportFilters, string]
	>) {
		const value = filters[key];
		if (value === undefined) continue;
		for (const v of Array.isArray(value) ? value : [value]) {
			params.append(paramName, v);
		}
	}
}

/** Сводка + тренд по дням из локального зеркала (замена summarize()/trendByDay()). */
export function useDealsSummary({
	range,
	previous = false,
	filters = {},
}: {
	range: DateRange;
	previous?: boolean;
	filters?: DealsReportFilters;
}) {
	return useQuery({
		queryKey: [
			"dashboard-deals-summary",
			formatDateParam(range.from),
			formatDateParam(range.to),
			previous,
			JSON.stringify(filters),
		],
		queryFn: async () => {
			const params = new URLSearchParams({
				from: formatDateParam(range.from),
				to: formatDateParam(range.to),
				...(previous ? { previous: "1" } : {}),
			});
			appendFilters(params, filters);
			const res = await fetch(`/api/dashboard/deals/summary?${params}`);
			if (!res.ok) throw new Error("Не удалось загрузить сводку");
			return (await res.json()) as {
				summary: DealsSummary;
				trend: DealsTrendPoint[];
				previousSummary?: DealsSummary;
			};
		},
	});
}
