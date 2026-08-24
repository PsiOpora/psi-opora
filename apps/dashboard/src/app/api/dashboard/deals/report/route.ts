import type {
	DealGroupDimension,
	DealStatus,
	GroupDealsOptions,
} from "@psi-opora/db/queries";
import { DEAL_GROUP_DIMENSIONS, groupDealsBy } from "@psi-opora/db/queries";
import { NextResponse } from "next/server";
import { parseDateRange } from "@/lib/analytics/date-range";
import {
	fetchCategoryNames,
	fetchFailReasonNames,
	fetchSourceNames,
	fetchStageNames,
} from "@/lib/analytics/deals";
import {
	parseNonEmptyStrings,
	parsePagination,
	validateDateRange,
	zodBadRequest,
} from "@/lib/api/validation";
import { UTM_CAMPAIGN_KEY_SEPARATOR } from "@/lib/constants/separators";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const SORT_FIELDS = new Set<NonNullable<GroupDealsOptions["sort"]>>([
	"key",
	"deals",
	"won",
	"opportunitySum",
	"wonSum",
	"conversionRate",
]);

function parseDimension(value: string | null): DealGroupDimension {
	return DEAL_GROUP_DIMENSIONS.includes(value as DealGroupDimension)
		? (value as DealGroupDimension)
		: "utmSource";
}

function parseSort(value: string | null): GroupDealsOptions["sort"] {
	return SORT_FIELDS.has(value as never)
		? (value as GroupDealsOptions["sort"])
		: undefined;
}

function isDealStatus(value: string): value is DealStatus {
	return value === "won" || value === "lost" || value === "in_progress";
}

function parseStatus(values: string[]): DealStatus | DealStatus[] | undefined {
	const valid = values.filter(isDealStatus);
	if (valid.length === 0) return undefined;
	return valid.length === 1 ? valid[0] : valid;
}

/** getAll() → undefined (нет параметра), одно значение или массив (несколько). */
function parseMulti(values: string[]): string | string[] | undefined {
	if (values.length === 0) return undefined;
	return values.length === 1 ? values[0] : values;
}

/**
 * Разрез по названиям — только для "source"/"category"/"stage"/"failReason"
 * (справочники из локального зеркала, packages/db/deal_dictionaries). Для
 * остальных измерений ключ группы из SQL (utm-значение, дата) уже человекочитаем.
 */
async function resolveNames(
	dimension: DealGroupDimension,
): Promise<Map<string, string>> {
	if (dimension === "source") return fetchSourceNames();
	if (dimension === "category") return fetchCategoryNames();
	if (dimension === "failReason") return fetchFailReasonNames();
	if (dimension === "stage") {
		const stages = await fetchStageNames();
		return new Map([...stages].map(([id, info]) => [id, info.name]));
	}
	return new Map();
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
		case "failReason":
			return names.get(key) ?? key;
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

	try {
		validateDateRange(params);
	} catch (err) {
		const res = zodBadRequest(err);
		if (res) return res;
		throw err;
	}

	let page: number;
	let pageSize: number;
	try {
		({ page, pageSize } = parsePagination(params, {
			defaultPageSize: DEFAULT_PAGE_SIZE,
			maxPageSize: MAX_PAGE_SIZE,
		}));
	} catch (err) {
		const res = zodBadRequest(err);
		if (res) return res;
		throw err;
	}

	// Без from/to — например, "активные сейчас" сделки (снэпшот без фильтра
	// по дате создания, как раньше fetchOpenDeals) — не подставляем дефолтный
	// 30-дневный диапазон в этом случае.
	const hasRange = params.has("from") || params.has("to");
	const range = hasRange
		? parseDateRange(Object.fromEntries(params))
		: undefined;

	let failReasonId: string | string[] | undefined;
	try {
		failReasonId = parseNonEmptyStrings(params.getAll("failReason"));
	} catch (err) {
		const res = zodBadRequest(err);
		if (res) return res;
		throw err;
	}

	const [group, names] = await Promise.all([
		groupDealsBy(dimension, {
			from: range?.from,
			to: range?.to,
			categoryId: parseMulti(params.getAll("category")),
			stageId: parseMulti(params.getAll("stage")),
			sourceId: parseMulti(params.getAll("source")),
			failReasonId,
			utmSource: parseMulti(params.getAll("utmSource")),
			utmMedium: parseMulti(params.getAll("utmMedium")),
			// utmCampaignFilter — фильтр по точному значению utm_campaign, не путать
			// с dimension=utmCampaign (составной ключ utm_source+utm_campaign для группировки).
			utmCampaign: parseMulti(params.getAll("utmCampaignFilter")),
			status: parseStatus(params.getAll("status")),
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
