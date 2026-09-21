import {
	ConcurrencyLimitStrategy,
	CreateTaskWorkflow,
} from "@hatchet-dev/typescript-sdk/v1";
import { fetchAdStats, getRedisOrNull } from "@psi-opora/bot-core";
import { getAdCredentials } from "@psi-opora/db/queries";

/**
 * Автоматическая синхронизация расхода из Яндекс.Директ в
 * ad_daily_stats (см. packages/db/src/schema/ads) — раньше требовала
 * ручного клика «Обновить» на /ads (adsRouter.refreshStats). Без крона
 * отчёт /attribution не набирал бы свежий расход сам по себе.
 * fetchAdStats без dateFrom/dateTo берёт последние 7 дней — этого достаточно
 * для регулярного дозаполнения (площадки досчитывают статистику с лагом
 * в 1-2 дня), но не восстанавливает историю до включения крона
 * (см. scripts/backfill-ads-stats.ts для разового бэкафилла).
 */
export const adsStatsSync = CreateTaskWorkflow({
	name: "ads-stats-sync",
	// Сдвиг минуты — чтобы не стартовать одновременно с другими крон-задачами.
	on: { cron: "23 */6 * * *" },
	retries: 1,
	executionTimeout: "5m",
	concurrency: {
		expression: "'ads-stats-sync'",
		maxRuns: 1,
		limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
	},
	fn: async () => {
		const creds = await getAdCredentials();
		if (!creds) return { skipped: true, campaigns: 0, totalSpend: 0 };
		const result = await fetchAdStats(getRedisOrNull(), creds);
		return {
			skipped: false,
			campaigns: result.campaigns.length,
			totalSpend: result.totalSpend,
		};
	},
});
