import {
	ConcurrencyLimitStrategy,
	CreateTaskWorkflow,
} from "@hatchet-dev/typescript-sdk/v1";
import {
	fetchAdStats,
	getRedisOrNull,
	loadAdEntityNames,
} from "@psi-opora/bot-core";
import {
	getAdCredentials,
	listAdTouchEntityRefsSince,
} from "@psi-opora/db/queries";
import { runSteps } from "./run-steps";

const ENTITIES_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Автоматическая синхронизация расхода из Яндекс.Директ в
 * ad_daily_stats (см. packages/db/src/schema/ads) — раньше требовала
 * ручного клика «Обновить» на /ads (adsRouter.refreshStats). Без крона
 * отчёт /attribution не набирал бы свежий расход сам по себе.
 * fetchAdStats без dateFrom/dateTo берёт последние 7 дней — этого достаточно
 * для регулярного дозаполнения (площадки досчитывают статистику с лагом
 * в 1-2 дня), но не восстанавливает историю до включения крона
 * (см. scripts/backfill-ads-stats.ts для разового бэкафилла).
 *
 * Вторым шагом догружает названия кампаний/групп/объявлений/ключей Директа
 * для ID из свежих касаний (ad_touches) в справочник ad_entities. Сделка и
 * так запрашивает недостающие названия при создании, но крон прогревает кэш
 * заранее — заявка не ждёт обращения к API — и освежает давно не
 * обновлявшиеся (переименованные в кабинете) названия.
 *
 * Два шага в одной задаче — из-за лимита Hatchet на число cron-триггеров.
 */
export const adsSync = CreateTaskWorkflow({
	name: "ads-sync",
	// Сдвиг минуты — чтобы не стартовать одновременно с другими крон-задачами.
	on: { cron: "23 */6 * * *" },
	retries: 1,
	executionTimeout: "10m",
	concurrency: {
		expression: "'ads-sync'",
		maxRuns: 1,
		limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
	},
	fn: async () =>
		runSteps({
			stats: async () => {
				const creds = await getAdCredentials();
				if (!creds) return { skipped: true, campaigns: 0, totalSpend: 0 };
				const result = await fetchAdStats(getRedisOrNull(), creds);
				return {
					skipped: false,
					campaigns: result.campaigns.length,
					totalSpend: result.totalSpend,
				};
			},
			entities: async () => {
				const rows = await listAdTouchEntityRefsSince(
					new Date(Date.now() - ENTITIES_LOOKBACK_MS),
				);
				const unique = (values: Array<string | null>) => [
					...new Set(values.filter((v): v is string => Boolean(v))),
				];
				const names = await loadAdEntityNames({
					campaignIds: unique(rows.map((r) => r.adCampaignId)),
					groupIds: unique(rows.map((r) => r.adGroupId)),
					adIds: unique(rows.map((r) => r.adId)),
					keywordIds: unique(rows.map((r) => r.keywordId)),
				});
				return { touches: rows.length, resolvedNames: names.size };
			},
		}),
});
