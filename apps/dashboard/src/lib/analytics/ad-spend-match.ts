import type { AdDailyStats } from "@psi-opora/db/queries";

/**
 * Хвостовые цифры в имени UTM-кампании — это, как правило, числовой ID
 * кампании рекламного кабинета (см. packages/bot-core/src/utils/site-codes.ts,
 * где `search_anorexia_708811857` содержит Yandex CampaignId). Используем это,
 * чтобы сматчить расход из ad_daily_stats без отдельной таблицы соответствий.
 * Общий модуль вместо копии в каждом потребителе (bot-funnel.ts, attribution.ts).
 */
const CAMPAIGN_ID_SUFFIX_RE = /(\d{6,})$/;

/** Расход в ad_daily_stats хранится в копейках (int) — переводим в рубли один раз здесь. */
export function aggregateAdSpendByCampaignId(
	adStats: AdDailyStats[],
): Map<string, number> {
	const spendByCampaignId = new Map<string, number>();
	for (const stat of adStats) {
		const spend = (stat.spend ?? 0) / 100;
		spendByCampaignId.set(
			stat.campaignId,
			(spendByCampaignId.get(stat.campaignId) ?? 0) + spend,
		);
	}
	return spendByCampaignId;
}

/** undefined — если в имени кампании нет числового ID или расход по нему не найден ("нет данных", не 0). */
export function matchAdSpend(
	campaignName: string,
	spendByCampaignId: Map<string, number>,
): number | undefined {
	const campaignId = campaignName.match(CAMPAIGN_ID_SUFFIX_RE)?.[1];
	return campaignId ? spendByCampaignId.get(campaignId) : undefined;
}
