import {
	ConcurrencyLimitStrategy,
	CreateTaskWorkflow,
} from "@hatchet-dev/typescript-sdk/v1";
import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import { env } from "@psi-opora/config";
import {
	syncChangedDeals,
	syncDealDictionaries,
	syncDeletedDeals,
} from "../deals-sync";

/**
 * Периодическая сверка локального зеркала сделок (packages/db, таблица
 * deals) с Bitrix24 — подстраховка на случай недоставленного вебхука
 * (OnCrmDealAdd/Update/Delete, apps/bitrix-webhook). Основная синхронизация —
 * вебхуки: syncChangedDeals досинхронизирует пропущенные добавления/
 * обновления по DATE_MODIFY, syncDeletedDeals — пропущенные удаления (по
 * DATE_MODIFY их не найти, поэтому сверяет id целиком). Перед первым
 * включением нужен разовый бэкафилл (scripts/backfill-deals.ts) — без него
 * джоба ничего не делает (см. syncChangedDeals).
 */
export const dealsSync = CreateTaskWorkflow({
	name: "deals-sync",
	// Сдвиг от */20 — чтобы не стартовать в ту же минуту, что другие крон-задачи,
	// дёргающие Bitrix REST (лимит ~2 запроса/сек).
	on: { cron: "2-59/20 * * * *" },
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
		const [result] = await Promise.all([
			(async () => {
				const deals = await syncChangedDeals(api);
				const deleted = await syncDeletedDeals(api);
				return { ...deals, ...deleted };
			})(),
			syncDealDictionaries(api),
		]);
		return result;
	},
});
