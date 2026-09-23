import { NextResponse } from "next/server";
import { fetchAttributionReport } from "@/lib/analytics/attribution";
import { parseDateRange } from "@/lib/analytics/date-range";
import { validateDateRange, zodBadRequest } from "@/lib/api/validation";

export const dynamic = "force-dynamic";

/**
 * Отчёт «Атрибуция» — источник/кампания, сделки/выручка (groupDealsBy) и
 * автоматический расход из ad_daily_stats (см. lib/analytics/attribution.ts).
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
	const report = await fetchAttributionReport(range);

	return NextResponse.json(report);
}
