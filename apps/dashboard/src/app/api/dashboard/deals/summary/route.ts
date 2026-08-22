import type { DealStatus } from "@psi-opora/db/queries";
import { getDealsSummary, getDealsTrendByDay } from "@psi-opora/db/queries";
import { NextResponse } from "next/server";
import { parseDateRange, previousRange } from "@/lib/analytics/date-range";
import { validateDateRange, zodBadRequest } from "@/lib/api/validation";

export const dynamic = "force-dynamic";

function isDealStatus(value: string): value is DealStatus {
  return value === "won" || value === "lost" || value === "in_progress";
}

function parseStatus(values: string[]): DealStatus | DealStatus[] | undefined {
  const valid = values.filter(isDealStatus);
  if (valid.length === 0) return undefined;
  return valid.length === 1 ? valid[0] : valid;
}

function parseMulti(values: string[]): string | string[] | undefined {
  if (values.length === 0) return undefined;
  return values.length === 1 ? values[0] : values;
}

/**
 * Сводка + тренд по дням из локального зеркала (замена summarize()/trendByDay()
 * из lib/analytics/aggregate.ts — теперь COUNT/SUM/GROUP BY на стороне БД).
 * previous=1 добавляет summary за предыдущий период той же длины (для KPI-карточек).
 * Фильтры конструктора отчётов (status/category/source/utm*) применяются к
 * summary так же, как к таблице/графику — см. hooks/use-deals-report.ts.
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

  const range = parseDateRange(Object.fromEntries(params));
  const filters = {
    status: parseStatus(params.getAll("status")),
    categoryId: parseMulti(params.getAll("category")),
    stageId: parseMulti(params.getAll("stage")),
    sourceId: parseMulti(params.getAll("source")),
    utmSource: parseMulti(params.getAll("utmSource")),
    utmMedium: parseMulti(params.getAll("utmMedium")),
    utmCampaign: parseMulti(params.getAll("utmCampaignFilter")),
  };

  const [summary, trend, previousSummary] = await Promise.all([
    getDealsSummary({ ...range, ...filters }),
    getDealsTrendByDay(range),
    params.get("previous") === "1"
      ? getDealsSummary({ ...previousRange(range), ...filters })
      : Promise.resolve(undefined),
  ]);

  return NextResponse.json({ summary, trend, previousSummary });
}
