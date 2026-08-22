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
 * Справочники сделок (имена источников/стадий/воронок) — из локального
 * зеркала (packages/db, таблица deal_dictionaries), синкается вместе со
 * сделками (packages/jobs/src/deals-sync.ts). Сами сделки читаются оттуда же
 * через /api/dashboard/deals* — см. hooks/use-deals-report.ts,
 * use-deals-summary.ts. `connected`/`dealDomain` — единственное, что ещё
 * зависит от live-подключения к Bitrix (для ссылок на карточки CRM и баннера
 * "не подключено"). `need` — список через запятую: sourceNames,
 * categoryNames, stageNames, dealDomain.
 */
export async function GET(request: Request) {
	const url = new URL(request.url);
	const need = new Set(
		(url.searchParams.get("need") ?? "").split(",").filter(Boolean),
	);

	const api = await getBitrixApi();

	try {
		const [sourceNames, categoryNames, stageNames, dealDomain] =
			await Promise.all([
				need.has("sourceNames")
					? fetchSourceNames()
					: Promise.resolve(undefined),
				need.has("categoryNames")
					? fetchCategoryNames()
					: Promise.resolve(undefined),
				need.has("stageNames") ? fetchStageNames() : Promise.resolve(undefined),
				api && need.has("dealDomain")
					? getBitrixPortalDomain()
					: Promise.resolve(undefined),
			]);

		return NextResponse.json({
			connected: !!api,
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
