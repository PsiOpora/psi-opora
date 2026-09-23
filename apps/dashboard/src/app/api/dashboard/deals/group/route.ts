import type {
	DealClientType,
	DealGroupDimension,
	DealStatus,
	ListDealsOptions,
} from "@psi-opora/db/queries";
import {
	DEAL_GROUP_DIMENSIONS,
	listDeals,
	listDealsInGroup,
} from "@psi-opora/db/queries";
import { NextResponse } from "next/server";
import { parseDateRange } from "@/lib/analytics/date-range";
import {
	parseNonEmptyStrings,
	parsePagination,
	validateDateRange,
	zodBadRequest,
} from "@/lib/api/validation";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const SORT_FIELDS = new Set<NonNullable<ListDealsOptions["sort"]>>([
	"title",
	"status",
	"opportunity",
	"dateCreate",
]);

function parseDimension(value: string | null): DealGroupDimension | null {
	return DEAL_GROUP_DIMENSIONS.includes(value as DealGroupDimension)
		? (value as DealGroupDimension)
		: null;
}

function parseSort(value: string | null): ListDealsOptions["sort"] {
	return SORT_FIELDS.has(value as never)
		? (value as ListDealsOptions["sort"])
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

function parseClientType(value: string | null): DealClientType | undefined {
	return value === "new" || value === "repeat" ? value : undefined;
}

function parseMulti(values: string[]): string | string[] | undefined {
	if (values.length === 0) return undefined;
	return values.length === 1 ? values[0] : values;
}

/**
 * Сделки одной группы разреза (клик по строке отчёта → диалог со списком) —
 * замена среза уже загруженного group.items на клиенте (GroupDealsDialog).
 * Без dimension и key — все сделки периода (клик по итоговой карточке отчёта).
 */
export async function GET(request: Request) {
	const url = new URL(request.url);
	const params = url.searchParams;
	const rawDimension = params.get("dimension");
	const dimension = parseDimension(rawDimension);
	const key = params.get("key");
	const isGroup = rawDimension !== null || key !== null;
	if (isGroup && (!dimension || key === null)) {
		return NextResponse.json(
			{ error: "Missing/invalid dimension or key" },
			{ status: 400 },
		);
	}

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

	const range = parseDateRange(Object.fromEntries(params));

	let failReasonId: string | string[] | undefined;
	try {
		failReasonId = parseNonEmptyStrings(params.getAll("failReason"));
	} catch (err) {
		const res = zodBadRequest(err);
		if (res) return res;
		throw err;
	}

	const options: ListDealsOptions = {
		from: range.from,
		to: range.to,
		status: parseStatus(params.getAll("status")),
		categoryId: parseMulti(params.getAll("category")),
		stageId: parseMulti(params.getAll("stage")),
		sourceId: parseMulti(params.getAll("source")),
		failReasonId,
		utmSource: parseMulti(params.getAll("utmSource")),
		utmMedium: parseMulti(params.getAll("utmMedium")),
		utmCampaign: parseMulti(params.getAll("utmCampaignFilter")),
		clientType: parseClientType(params.get("clientType")),
		search: params.get("search") ?? undefined,
		sort: parseSort(params.get("sort")),
		sortDir: params.get("sortDir") === "asc" ? "asc" : "desc",
		limit: pageSize,
		offset: (page - 1) * pageSize,
	};
	const { rows, total } =
		dimension && key !== null
			? await listDealsInGroup(dimension, key, options)
			: await listDeals(options);

	return NextResponse.json({ rows, total, page, pageSize });
}
