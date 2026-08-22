"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { parseDateRange } from "@/lib/analytics/date-range";
import type { StageInfo } from "@/lib/analytics/deals";

export type BitrixNeed =
	| "sourceNames"
	| "categoryNames"
	| "stageNames"
	| "dealDomain";

interface BitrixDataResult {
	connected: boolean;
	sourceNames?: Map<string, string>;
	categoryNames?: Map<string, string>;
	stageNames?: Map<string, StageInfo>;
	dealDomain?: string | null;
}

/** Диапазон дат из ?from=&to= — как раньше в серверных страницах, но на клиенте. */
export function useDashboardRange() {
	const searchParams = useSearchParams();
	return parseDateRange(Object.fromEntries(searchParams.entries()));
}

/**
 * Справочники Bitrix24 через /api/dashboard/bitrix (имена источников/стадий/
 * воронок, домен портала — дешёвые нефильтруемые запросы, живьём). Сами
 * сделки читаются из локального зеркала — см. hooks/use-deals-report.ts,
 * use-deals-summary.ts.
 */
export function useBitrixData(need: BitrixNeed[]) {
	const range = useDashboardRange();
	const from = range.from.toISOString();
	const to = range.to.toISOString();
	const needKey = [...need].sort().join(",");

	return useQuery({
		queryKey: ["dashboard-bitrix", from, to, needKey],
		queryFn: async (): Promise<BitrixDataResult> => {
			const params = new URLSearchParams({ from, to, need: needKey });
			const res = await fetch(`/api/dashboard/bitrix?${params}`);
			if (!res.ok) throw new Error("Не удалось загрузить данные Bitrix24");
			const json = await res.json();
			if (!json.connected) return { connected: false };
			return {
				connected: true,
				sourceNames: json.sourceNames
					? new Map<string, string>(json.sourceNames)
					: undefined,
				categoryNames: json.categoryNames
					? new Map<string, string>(json.categoryNames)
					: undefined,
				stageNames: json.stageNames
					? new Map<string, StageInfo>(json.stageNames)
					: undefined,
				dealDomain: json.dealDomain ?? null,
			};
		},
	});
}
