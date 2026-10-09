import {
	ConcurrencyLimitStrategy,
	CreateTaskWorkflow,
} from "@hatchet-dev/typescript-sdk/v1";
import { loadAdEntityNames } from "@psi-opora/bot-core";
import { listAdTouchEntityRefsSince } from "@psi-opora/db/queries";

const LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Догружает названия кампаний/групп/объявлений/ключей Директа для ID из
 * свежих касаний (ad_touches) в справочник ad_entities. Сделка и так
 * запрашивает недостающие названия при создании, но крон прогревает кэш
 * заранее — заявка не ждёт обращения к API — и освежает давно не
 * обновлявшиеся (переименованные в кабинете) названия.
 */
export const adEntitiesSync = CreateTaskWorkflow({
	name: "ad-entities-sync",
	// Сдвиг минуты — чтобы не стартовать одновременно с ads-stats-sync.
	on: { cron: "37 */6 * * *" },
	retries: 1,
	executionTimeout: "5m",
	concurrency: {
		expression: "'ad-entities-sync'",
		maxRuns: 1,
		limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
	},
	fn: async () => {
		const rows = await listAdTouchEntityRefsSince(
			new Date(Date.now() - LOOKBACK_MS),
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
});
