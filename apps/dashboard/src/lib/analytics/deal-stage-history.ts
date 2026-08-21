import type { StageInfo } from "./deals";

/** Кол-во уникальных сделок на стадии за период — сырой ответ API-роута. */
export interface StageReachCount {
	stageId: string;
	uniqueDeals: number;
}

export interface FunnelStepStats {
	step: string;
	label: string;
	count: number;
	shareOfStart: number;
	stepConversion: number;
}

/**
 * Историческая воронка "достигших стадии хотя бы раз за период" — в отличие
 * от funnelByStage (aggregate.ts), который считает текущую стадию сделок.
 * Чистая функция: counts уже отфильтрованы по воронке на сервере
 * (getStageReachCounts), здесь только сортировка по порядку стадий и расчёт
 * конверсии между соседними шагами.
 */
export function stageReachFunnel(
	counts: StageReachCount[],
	stageNames: Map<string, StageInfo>,
): FunnelStepStats[] {
	const byStage = new Map(counts.map((c) => [c.stageId, c.uniqueDeals]));
	const orderedStageIds = [...byStage.keys()].sort(
		(a, b) =>
			(stageNames.get(a)?.sort ?? Number.MAX_SAFE_INTEGER) -
			(stageNames.get(b)?.sort ?? Number.MAX_SAFE_INTEGER),
	);
	const start = byStage.get(orderedStageIds[0] ?? "") ?? 0;

	return orderedStageIds.map((stageId, i) => {
		const count = byStage.get(stageId) ?? 0;
		const prevCount =
			i === 0 ? count : (byStage.get(orderedStageIds[i - 1] ?? "") ?? 0);
		return {
			step: stageId,
			label: stageNames.get(stageId)?.name ?? stageId,
			count,
			shareOfStart: start > 0 ? count / start : 0,
			stepConversion: i === 0 ? 1 : prevCount > 0 ? count / prevCount : 0,
		};
	});
}
