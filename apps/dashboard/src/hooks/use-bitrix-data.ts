"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { z } from "zod";
import { parseDateRange } from "@/lib/analytics/date-range";
import type { StageInfo } from "@/lib/analytics/deals";

export type BitrixNeed =
	| "sourceNames"
	| "categoryNames"
	| "stageNames"
	| "failReasonNames"
	| "dealDomain";

interface BitrixDataResult {
	connected: boolean;
	sourceNames?: Map<string, string>;
	categoryNames?: Map<string, string>;
	stageNames?: Map<string, StageInfo>;
	failReasonNames?: Map<string, string>;
	dealDomain?: string | null;
}

const bitrixResponseSchema = z.object({
	connected: z.boolean(),
	sourceNames: z.array(z.tuple([z.string(), z.string()])).optional(),
	categoryNames: z.array(z.tuple([z.string(), z.string()])).optional(),
	stageNames: z
		.array(
			z.tuple([
				z.string(),
				z.object({
					name: z.string(),
					sort: z.number(),
				}),
			]),
		)
		.optional(),
	failReasonNames: z.array(z.tuple([z.string(), z.string()])).optional(),
	dealDomain: z.string().nullable().optional(),
});

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
			const rawJson = await res.json();

			// Validate response structure before processing
			const validated = bitrixResponseSchema.safeParse(rawJson);
			if (!validated.success) {
				console.error(
					"[useBitrixData] Invalid response structure:",
					validated.error,
				);
				throw new Error("Некорректный формат данных от сервера");
			}

			const json = validated.data;
			if (!json.connected) return { connected: false };

			return {
				connected: true,
				sourceNames: json.sourceNames
					? new Map<string, string>(
							json.sourceNames.filter(
								(pair): pair is [string, string] =>
									Array.isArray(pair) &&
									pair.length === 2 &&
									typeof pair[0] === "string" &&
									typeof pair[1] === "string",
							),
						)
					: undefined,
				categoryNames: json.categoryNames
					? new Map<string, string>(
							json.categoryNames.filter(
								(pair): pair is [string, string] =>
									Array.isArray(pair) &&
									pair.length === 2 &&
									typeof pair[0] === "string" &&
									typeof pair[1] === "string",
							),
						)
					: undefined,
				stageNames: json.stageNames
					? new Map<string, StageInfo>(json.stageNames)
					: undefined,
				failReasonNames: json.failReasonNames
					? new Map<string, string>(
							json.failReasonNames.filter(
								(pair): pair is [string, string] =>
									Array.isArray(pair) &&
									pair.length === 2 &&
									typeof pair[0] === "string" &&
									typeof pair[1] === "string",
							),
						)
					: undefined,
				dealDomain: json.dealDomain ?? null,
			};
		},
	});
}
