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
 * (getStageReachCounts), здесь только сортировка по порядку стадий.
 * ВНИМАНИЕ: В режиме "reached" каждая стадия считается независимо (все сделки,
 * которые когда-либо её достигли за период), поэтому метрики конверсии и доли
 * от старта отключены (некорректны для независимых множеств, могут дать >100%).
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

	return orderedStageIds.map((stageId) => {
		const count = byStage.get(stageId) ?? 0;
		return {
			step: stageId,
			label: stageNames.get(stageId)?.name ?? stageId,
			count,
			shareOfStart: 0, // Отключено: независимые per-stage counts
			stepConversion: 0, // Отключено: независимые per-stage counts
		};
	});
}
