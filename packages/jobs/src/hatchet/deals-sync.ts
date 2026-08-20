import {
	ConcurrencyLimitStrategy,
	CreateTaskWorkflow,
} from "@hatchet-dev/typescript-sdk/v1";
import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import { env } from "@psi-opora/config";
import { syncChangedDeals } from "../deals-sync";

/**
 * Периодическая сверка локального зеркала сделок (packages/db, таблица
 * deals) с Bitrix24 — подстраховка на случай недоставленного вебхука
 * (OnCrmDealAdd/Update/Delete, apps/bitrix-webhook). Основная синхронизация —
 * вебхуки, эта джоба только досинхронизирует пропущенное по DATE_MODIFY.
 * Перед первым включением нужен разовый бэкафилл (scripts/backfill-deals.ts) —
 * без него джоба ничего не делает (см. syncChangedDeals).
 */
export const dealsSync = CreateTaskWorkflow({
	name: "deals-sync",
	on: { cron: "*/10 * * * *" },
	retries: 0,
	executionTimeout: "10m",
	// Один прогон за раз — параллельная сверка лишь дублирует нагрузку на Bitrix REST.
	concurrency: {
		expression: "'deals-sync'",
		maxRuns: 1,
		limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
	},
	fn: async () => {
		const api = resolveBitrixApi(env.BITRIX_MEMBER_ID);
		if (!api) throw new Error("Bitrix24 не подключён");
		return await syncChangedDeals(api);
	},
});
