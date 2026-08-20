import { getDealsSummary, getDealsTrendByDay } from "@psi-opora/db/queries";
import { NextResponse } from "next/server";
import { parseDateRange, previousRange } from "@/lib/analytics/date-range";

export const dynamic = "force-dynamic";

/**
 * Сводка + тренд по дням из локального зеркала (замена summarize()/trendByDay()
 * из lib/analytics/aggregate.ts — теперь COUNT/SUM/GROUP BY на стороне БД).
 * previous=1 добавляет summary за предыдущий период той же длины (для KPI-карточек).
 */
export async function GET(request: Request) {
	const url = new URL(request.url);
	const params = url.searchParams;
	const range = parseDateRange(Object.fromEntries(params));

	const [summary, trend, previousSummary] = await Promise.all([
		getDealsSummary(range),
		getDealsTrendByDay(range),
		params.get("previous") === "1"
			? getDealsSummary(previousRange(range))
			: Promise.resolve(undefined),
	]);

	return NextResponse.json({ summary, trend, previousSummary });
}
