import { getStageReachCounts } from "@psi-opora/db/queries";
import { NextResponse } from "next/server";
import { parseDateRange } from "@/lib/analytics/date-range";
import { validateDateRange, zodBadRequest } from "@/lib/api/validation";

export const dynamic = "force-dynamic";

/**
 * Кол-во уникальных сделок, побывавших на каждой стадии воронки за период —
 * из локальной истории (packages/db, таблица deal_stage_history). Отдаёт
 * только сырые счётчики; порядок/подписи стадий уже есть на клиенте
 * (useBitrixData(["stageNames"])), поэтому мерджится там же
 * (apps/dashboard/src/lib/analytics/deal-stage-history.ts).
 */
export async function GET(request: Request) {
	const url = new URL(request.url);
	const params = url.searchParams;
	const categoryId = params.get("category");
	if (!categoryId) {
		return NextResponse.json(
			{ error: "category обязателен" },
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

	const range = parseDateRange(Object.fromEntries(params));

	try {
		const rows = await getStageReachCounts({
			categoryId,
			from: range.from,
			to: range.to,
		});
		return NextResponse.json({ rows });
	} catch (error) {
		console.error("[api/dashboard/deal-stage-history] error:", error);
		return NextResponse.json(
			{ error: (error as Error).message },
			{ status: 500 },
		);
	}
}
