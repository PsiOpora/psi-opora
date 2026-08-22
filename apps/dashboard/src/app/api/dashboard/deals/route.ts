import type { DealStatus, ListDealsOptions } from "@psi-opora/db/queries";
import { listDeals } from "@psi-opora/db/queries";
import { NextResponse } from "next/server";
import { parseDateRange } from "@/lib/analytics/date-range";
import {
	parsePagination,
	validateDateRange,
	zodBadRequest,
} from "@/lib/api/validation";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const SORT_FIELDS = new Set<NonNullable<ListDealsOptions["sort"]>>([
	"title",
	"status",
	"opportunity",
	"dateCreate",
]);

function parseSort(value: string | null): ListDealsOptions["sort"] {
	return SORT_FIELDS.has(value as never)
		? (value as ListDealsOptions["sort"])
		: undefined;
}

function parseStatus(value: string | null): DealStatus | undefined {
	return value === "won" || value === "lost" || value === "in_progress"
		? value
		: undefined;
}

/**
 * Список сделок из локального зеркала (packages/db, таблица deals) — с
 * серверными фильтрацией/сортировкой/пагинацией вместо загрузки всего
 * диапазона в браузер. Заменяет "deals"/"previousDeals"/"openDeals" из
 * /api/dashboard/bitrix для страниц, переехавших на этот эндпоинт.
 */
export async function GET(request: Request) {
	const url = new URL(request.url);
	const params = url.searchParams;

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

	const hasRange = params.has("from") || params.has("to");
	const range = hasRange
		? parseDateRange(Object.fromEntries(params))
		: undefined;

	// "Достигли этапа" (историческая воронка, apps/dashboard/src/app/(dashboard)/funnel):
	// from/to здесь — не dateCreate, а окно даты входа в reachedStage (см.
	// ListDealsOptions.reachedStage) — поэтому при заданном reachedStage не
	// применяем их как фильтр по dateCreate ниже.
	const reachedStageId = params.get("reachedStage");
	const reachedCategoryId = params.get("reachedCategory");
	const hasReachedStageId = reachedStageId !== null;
	const hasReachedCategoryId = reachedCategoryId !== null;
	const hasPartialReachedFilter =
		(hasReachedStageId || hasReachedCategoryId) &&
		!(reachedStageId && reachedCategoryId && range);
	if (hasPartialReachedFilter) {
		return NextResponse.json(
			{
				error:
					"reachedStage, reachedCategory, from, and to must all be provided together",
			},
			{ status: 400 },
		);
	}
	const reachedStage =
		reachedStageId && reachedCategoryId && range
			? {
					stageId: reachedStageId,
					categoryId: reachedCategoryId,
					from: range.from,
					to: range.to,
				}
			: undefined;

	const { rows, total } = await listDeals({
		from: reachedStage ? undefined : range?.from,
		to: reachedStage ? undefined : range?.to,
		status: parseStatus(params.get("status")),
		categoryId: params.get("category") ?? undefined,
		stageId: params.get("stage") ?? undefined,
		sourceId: params.get("source") ?? undefined,
		utmSource: params.get("utmSource") ?? undefined,
		search: params.get("search") ?? undefined,
		reachedStage,
		sort: parseSort(params.get("sort")),
		sortDir: params.get("sortDir") === "asc" ? "asc" : "desc",
		limit: pageSize,
		offset: (page - 1) * pageSize,
	});

	return NextResponse.json({ rows, total, page, pageSize });
}
