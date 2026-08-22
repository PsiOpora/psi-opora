import { NextResponse } from "next/server";
import {
	fetchCategoryNames,
	fetchSourceNames,
	fetchStageNames,
} from "@/lib/analytics/deals";
import { getBitrixPortalDomain } from "@/lib/bitrix/deal-link";
import { getBitrixApi } from "@/lib/bitrix/session";

export const dynamic = "force-dynamic";

/**
 * Справочники Bitrix24 (имена источников/стадий/воронок, домен портала) —
 * дешёвые нефильтруемые запросы, живьём. Сами сделки читаются из локального
 * зеркала (packages/db, таблица deals) через /api/dashboard/deals* —
 * см. hooks/use-deals-report.ts, use-deals-summary.ts. `need` — список
 * через запятую: sourceNames, categoryNames, stageNames, dealDomain.
 */
export async function GET(request: Request) {
	const url = new URL(request.url);
	const need = new Set(
		(url.searchParams.get("need") ?? "").split(",").filter(Boolean),
	);

	const api = await getBitrixApi();
	if (!api) {
		return NextResponse.json({ connected: false });
	}

	try {
		const [sourceNames, categoryNames, stageNames, dealDomain] =
			await Promise.all([
				need.has("sourceNames")
					? fetchSourceNames(api)
					: Promise.resolve(undefined),
				need.has("categoryNames")
					? fetchCategoryNames(api)
					: Promise.resolve(undefined),
				need.has("stageNames")
					? fetchStageNames(api)
					: Promise.resolve(undefined),
				need.has("dealDomain")
					? getBitrixPortalDomain()
					: Promise.resolve(undefined),
			]);

		return NextResponse.json({
			connected: true,
			sourceNames: sourceNames ? [...sourceNames.entries()] : undefined,
			categoryNames: categoryNames ? [...categoryNames.entries()] : undefined,
			stageNames: stageNames ? [...stageNames.entries()] : undefined,
			dealDomain,
		});
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.includes("INVALID_CREDENTIALS")
		) {
			return NextResponse.json({ connected: false });
		}
		console.error("[api/dashboard/bitrix] error:", error);
		return NextResponse.json(
			{ error: (error as Error).message },
			{ status: 500 },
		);
	}
}
