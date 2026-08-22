import { getFilterFacets } from "@psi-opora/db/queries";
import { NextResponse } from "next/server";
import { parseDateRange } from "@/lib/analytics/date-range";
import { fetchCategoryNames, fetchSourceNames } from "@/lib/analytics/deals";
import { STATUS_LABEL } from "@/lib/analytics/status-label";
import { validateDateRange, zodBadRequest } from "@/lib/api/validation";

export const dynamic = "force-dynamic";

/**
 * Счётчики по значениям для фильтров конструктора отчётов (ReportBuilder) —
 * замена filterOptions, который раньше считался проходом по всем сделкам
 * периода в браузере (lib/analytics/aggregate.ts).
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

	const [facets, categoryNames, sourceNames] = await Promise.all([
		getFilterFacets(range),
		fetchCategoryNames(),
		fetchSourceNames(),
	]);

	return NextResponse.json({
		status: facets.status.map((f) => ({
			...f,
			label:
				STATUS_LABEL[f.value as keyof typeof STATUS_LABEL]?.label ?? f.value,
		})),
		categoryId: facets.categoryId.map((f) => ({
			...f,
			label: categoryNames.get(f.value) ?? `Воронка ${f.value}`,
		})),
		sourceId: facets.sourceId.map((f) => ({
			...f,
			label: sourceNames.get(f.value) ?? f.value,
		})),
		utmSource: facets.utmSource.map((f) => ({ ...f, label: f.value })),
		utmMedium: facets.utmMedium.map((f) => ({ ...f, label: f.value })),
		utmCampaign: facets.utmCampaign.map((f) => ({ ...f, label: f.value })),
	});
}
