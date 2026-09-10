import {
	ConcurrencyLimitStrategy,
	CreateTaskWorkflow,
} from "@hatchet-dev/typescript-sdk/v1";
import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import { env } from "@psi-opora/config";
import { syncStageHistory } from "../deal-stage-history-sync";

/**
 * Периодическая синхронизация истории стадий сделок (packages/db, таблица
 * deal_stage_history) — единственный источник данных, вебхука нет:
 * crm.stagehistory.list — авторитетный полный лог Bitrix24, курсорный поллинг
 * не теряет переходы (в отличие от диффа по OnCrmDealUpdate). Перед первым
 * включением нужен разовый бэкафилл (scripts/backfill-deal-stage-history.ts) —
 * без него джоба просто досинхронизирует с нуля за несколько прогонов.
 */
export const dealStageHistorySync = CreateTaskWorkflow({
	name: "deal-stage-history-sync",
	// Сдвиг от */10 — чтобы не стартовать в ту же минуту, что другие крон-задачи,
	// дёргающие Bitrix REST (лимит ~2 запроса/сек).
	on: { cron: "7-59/10 * * * *" },
	retries: 0,
	executionTimeout: "10m",
	// Один прогон за раз — параллельная синхронизация лишь дублирует нагрузку на Bitrix REST.
	concurrency: {
		expression: "'deal-stage-history-sync'",
		maxRuns: 1,
		limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
	},
	fn: async () => {
		const api = resolveBitrixApi(env.BITRIX_MEMBER_ID);
		if (!api) throw new Error("Bitrix24 не подключён");
		return await syncStageHistory(api);
	},
});
