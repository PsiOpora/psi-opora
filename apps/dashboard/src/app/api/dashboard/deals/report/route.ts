import type { DealGroupDimension, GroupDealsOptions } from "@psi-opora/db/queries";
import { groupDealsBy } from "@psi-opora/db/queries";
import { NextResponse } from "next/server";
import { parseDateRange } from "@/lib/analytics/date-range";
import {
	fetchCategoryNames,
	fetchSourceNames,
	fetchStageNames,
} from "@/lib/analytics/deals";
import { getBitrixApi } from "@/lib/bitrix/session";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// Разделитель ключа utmCampaign (source+campaign) — совпадает с тем, что
// использует SQL-выражение chr(0) в packages/db/src/queries/deals.ts::dimensionKeyExpr.
const UTM_CAMPAIGN_KEY_SEPARATOR = String.fromCharCode(0);

const DIMENSIONS: DealGroupDimension[] = [
	"utmSource",
	"utmMedium",
	"utmCampaign",
	"utmContent",
	"utmTerm",
	"source",
	"category",
	"stage",
	"day",
	"week",
	"month",
];

const SORT_FIELDS = new Set<NonNullable<GroupDealsOptions["sort"]>>([
	"key",
	"deals",
	"won",
	"opportunitySum",
	"wonSum",
	"conversionRate",
]);

function parseDimension(value: string | null): DealGroupDimension {
	return DIMENSIONS.includes(value as DealGroupDimension)
		? (value as DealGroupDimension)
		: "utmSource";
}

function parseSort(value: string | null): GroupDealsOptions["sort"] {
	return SORT_FIELDS.has(value as never)
		? (value as GroupDealsOptions["sort"])
		: undefined;
}

/**
 * Разрез по названиям — только для "source"/"category"/"stage" (дешёвые,
 * редко меняющиеся справочники Bitrix24, живьём). Для остальных измерений
 * ключ группы из SQL (utm-значение, дата) уже человекочитаем.
 */
async function resolveNames(
	dimension: DealGroupDimension,
): Promise<Map<string, string>> {
	if (dimension !== "source" && dimension !== "category" && dimension !== "stage") {
		return new Map();
	}
	const api = await getBitrixApi();
	if (!api) return new Map();
	if (dimension === "source") return fetchSourceNames(api);
	if (dimension === "category") return fetchCategoryNames(api);
	const stages = await fetchStageNames(api);
	return new Map([...stages].map(([id, info]) => [id, info.name]));
}

function labelOf(
	dimension: DealGroupDimension,
	key: string,
	names: Map<string, string>,
): string {
	switch (dimension) {
		case "source":
			return names.get(key) ?? key;
		case "category":
			return names.get(key) ?? `Воронка ${key}`;
		case "stage":
			return names.get(key) ?? key;
		case "utmCampaign": {
			const [source, campaign] = key.split(UTM_CAMPAIGN_KEY_SEPARATOR);
			return `${source || "Без utm_source"} / ${campaign || "Без utm_campaign"}`;
		}
		default:
			return key || "Без метки";
	}
}

/**
 * Группировка сделок по разрезу (замена groupByUtmX/bucketBy+computeGroupStats
 * из lib/analytics/aggregate.ts) — агрегация, сортировка и пагинация в SQL
 * (packages/db/src/queries/deals.ts::groupDealsBy), а не в браузере.
 */
export async function GET(request: Request) {
	const url = new URL(request.url);
	const params = url.searchParams;
	const dimension = parseDimension(params.get("dimension"));

	const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
	const pageSize = Math.min(
		MAX_PAGE_SIZE,
		Math.max(1, Number(params.get("pageSize") ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE),
	);
	const range = parseDateRange(Object.fromEntries(params));

	const [group, names] = await Promise.all([
		groupDealsBy(dimension, {
			from: range.from,
			to: range.to,
			categoryId: params.get("category") ?? undefined,
			stageId: params.get("stage") ?? undefined,
			sourceId: params.get("source") ?? undefined,
			utmSource: params.get("utmSource") ?? undefined,
			status: undefined,
			sort: parseSort(params.get("sort")),
			sortDir: params.get("sortDir") === "asc" ? "asc" : "desc",
			limit: pageSize,
			offset: (page - 1) * pageSize,
		}),
		resolveNames(dimension),
	]);

	const rows = group.rows.map((row) => ({
		...row,
		label: labelOf(dimension, row.key, names),
	}));

	return NextResponse.json({ rows, total: group.total, page, pageSize });
}
