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

  const { rows, total } = await listDeals({
    from: range?.from,
    to: range?.to,
    status: parseStatus(params.get("status")),
    categoryId: params.get("category") ?? undefined,
    stageId: params.get("stage") ?? undefined,
    sourceId: params.get("source") ?? undefined,
    utmSource: params.get("utmSource") ?? undefined,
    search: params.get("search") ?? undefined,
    sort: parseSort(params.get("sort")),
    sortDir: params.get("sortDir") === "asc" ? "asc" : "desc",
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return NextResponse.json({ rows, total, page, pageSize });
}
