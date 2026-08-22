"use client";

import type { DealGroupDimension, DealStatus } from "@psi-opora/db/queries";
import { useQuery } from "@tanstack/react-query";
import type { GroupStatsRow } from "@/components/dashboard/group-stats-table";
import type { DateRange } from "@/lib/analytics/types";

const DEFAULT_PAGE_SIZE = 20;
/** Потолок pageSize на сервере (apps/dashboard/.../deals/report/route.ts) —
 * fetchAllDealsReportRows пролистывает страницы этого размера, чтобы не
 * упереться в него при выгрузке CSV. */
const REPORT_MAX_PAGE_SIZE = 100;

export type DealsReportSort =
	| "key"
	| "deals"
	| "won"
	| "opportunitySum"
	| "wonSum"
	| "conversionRate";

type MultiValue<T extends string> = T | T[];

export interface DealsReportFilters {
	status?: MultiValue<DealStatus>;
	categoryId?: MultiValue<string>;
	stageId?: MultiValue<string>;
	sourceId?: MultiValue<string>;
	utmSource?: MultiValue<string>;
	utmMedium?: MultiValue<string>;
	/** Точное значение utm_campaign (не путать с dimension="utmCampaign" —
	 * составным ключом utm_source+utm_campaign для группировки). */
	utmCampaign?: MultiValue<string>;
}

export interface UseDealsReportOptions extends DealsReportFilters {
	dimension: DealGroupDimension;
	/** Без диапазона — снэпшот без фильтра по дате создания (как раньше fetchOpenDeals). */
	range?: DateRange;
	page?: number;
	pageSize?: number;
	sort?: DealsReportSort;
	sortDir?: "asc" | "desc";
	enabled?: boolean;
}

const FILTER_PARAM_NAME: Record<keyof DealsReportFilters, string> = {
	status: "status",
	categoryId: "category",
	stageId: "stage",
	sourceId: "source",
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

function reportUrl(
	dimension: DealGroupDimension,
	range: DateRange | undefined,
	filters: DealsReportFilters,
	extra: Record<string, string>,
): string {
	const params = new URLSearchParams({
		dimension,
		...(range
			? { from: range.from.toISOString(), to: range.to.toISOString() }
			: {}),
		...extra,
	});
	appendFilters(params, filters);
	return `/api/dashboard/deals/report?${params}`;
}

/** Ключ для useQuery — сериализует фильтры стабильно (порядок значений в массиве важен). */
function filtersKey(filters: DealsReportFilters): string {
	return JSON.stringify(filters);
}

/** Одна страница отчёта по разрезу — таблица/график берут данные отсюда. */
export function useDealsReport({
	dimension,
	range,
	page = 1,
	pageSize = DEFAULT_PAGE_SIZE,
	sort,
	sortDir,
	status,
	categoryId,
	stageId,
	sourceId,
	utmSource,
	utmMedium,
	utmCampaign,
	enabled = true,
}: UseDealsReportOptions) {
	const filters: DealsReportFilters = {
		status,
		categoryId,
		stageId,
		sourceId,
		utmSource,
		utmMedium,
		utmCampaign,
	};
	return useQuery({
		queryKey: [
			"dashboard-deals-report",
			dimension,
			range?.from.toISOString(),
			range?.to.toISOString(),
			page,
			pageSize,
			sort,
			sortDir,
			filtersKey(filters),
		],
		queryFn: async () => {
			const res = await fetch(
				reportUrl(dimension, range, filters, {
					page: String(page),
					pageSize: String(pageSize),
					...(sort ? { sort } : {}),
					...(sortDir ? { sortDir } : {}),
				}),
			);
			if (!res.ok) throw new Error("Не удалось загрузить отчёт");
			return (await res.json()) as {
				rows: GroupStatsRow[];
				total: number;
				page: number;
				pageSize: number;
			};
		},
		enabled,
	});
}

/** Все строки разреза без пагинации — для CSV-экспорта по требованию. */
export async function fetchAllDealsReportRows(
	dimension: DealGroupDimension,
	range: DateRange | undefined,
	filters: DealsReportFilters = {},
): Promise<GroupStatsRow[]> {
	const all: GroupStatsRow[] = [];
	let page = 1;
	for (;;) {
		const res = await fetch(
			reportUrl(dimension, range, filters, {
				page: String(page),
				pageSize: String(REPORT_MAX_PAGE_SIZE),
				sort: "key",
				sortDir: "asc",
			}),
		);
		if (!res.ok) throw new Error("Не удалось загрузить отчёт");
		const json = (await res.json()) as { rows: GroupStatsRow[]; total: number };
		all.push(...json.rows);
		if (all.length >= json.total || json.rows.length === 0) break;
		page++;
	}
	return all;
}
