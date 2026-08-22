import type { DealGroupDimension, ListDealsOptions } from "@psi-opora/db/queries";
import { DEAL_GROUP_DIMENSIONS, listDealsInGroup } from "@psi-opora/db/queries";
import { NextResponse } from "next/server";
import { parseDateRange } from "@/lib/analytics/date-range";
import {
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

/**
 * Сделки одной группы разреза (клик по строке отчёта → диалог со списком) —
 * замена среза уже загруженного group.items на клиенте (GroupDealsDialog).
 */
export async function GET(request: Request) {
	const url = new URL(request.url);
	const params = url.searchParams;
	const dimension = parseDimension(params.get("dimension"));
	const key = params.get("key");
	if (!dimension || key === null) {
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

	const { rows, total } = await listDealsInGroup(dimension, key, {
		from: range.from,
		to: range.to,
		search: params.get("search") ?? undefined,
		sort: parseSort(params.get("sort")),
		sortDir: params.get("sortDir") === "asc" ? "asc" : "desc",
		limit: pageSize,
		offset: (page - 1) * pageSize,
	});

	return NextResponse.json({ rows, total, page, pageSize });
}
