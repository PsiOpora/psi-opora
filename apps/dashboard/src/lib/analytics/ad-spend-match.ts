import type { AdCampaignIdOverride, AdDailyStats } from "@psi-opora/db/queries";

/**
 * Хвостовые цифры в имени UTM-кампании — это, как правило, числовой ID
 * кампании рекламного кабинета (см. packages/bot-core/src/utils/site-codes.ts,
 * где `search_anorexia_708811857` содержит Yandex CampaignId). Используем это,
 * чтобы сматчить расход из ad_daily_stats без отдельной таблицы соответствий.
 * Общий модуль вместо копии в каждом потребителе (bot-funnel.ts, attribution.ts).
 */
const CAMPAIGN_ID_SUFFIX_RE = /(\d{6,})$/;

export function getAdCampaignId(campaignName: string): string | undefined {
	return campaignName.match(CAMPAIGN_ID_SUFFIX_RE)?.[1];
}

/**
 * Расход из ad_daily_stats (Яндекс.Директ) матчим только сделкам с
 * utm_source="yandex" — тот же текст кампании может случайно встретиться и
 * у сделок из других источников (например, веб-форма Bitrix со своим
 * utm_source="ya", или фолбэк-тег бота utm_medium="max_bot" при
 * нераспознанном start-параметре) — таким сделкам реальный расход
 * Директа не принадлежит, а без этой проверки на них "сматчивался" бы
 * весь расход кампании целиком, задваивая его в отчёте и портя их
 * собственные CPL/CAC/ROMI.
 */
const YANDEX_SOURCE = "yandex";

/**
 * Ручные привязки (ad_campaign_id_overrides, настраиваются в
 * /settings/ads) перекрывают автовывод по цифрам в имени — нужны, когда
 * кампанию пересоздали в рекламном кабинете (новый ID), а трекинговую
 * ссылку со старым ID никто не поменял. Без привязки такая кампания
 * навсегда осталась бы без сматченного расхода.
 */
export function resolveAdCampaignId(
	source: string,
	campaignName: string,
	overrides: Map<string, string>,
): string | undefined {
	if (source !== YANDEX_SOURCE) return undefined;
	return overrides.get(campaignName) ?? getAdCampaignId(campaignName);
}

export function buildAdCampaignIdOverridesMap(
	rows: AdCampaignIdOverride[],
): Map<string, string> {
	return new Map(rows.map((row) => [row.utmCampaign, row.adCampaignId]));
}

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

/**
 * Название кампании из рекламного кабинета (CampaignName, тянется вместе с
 * расходом при синке ad_daily_stats) по её ID — для подписи в отчётах рядом с
 * UTM-меткой, которая сама по себе часто нечитаема (см. ad_daily_stats.campaignName
 * в packages/bot-core/src/utils/ads-stats.ts). Берём самую свежую запись по
 * дате на случай, если кампанию в кабинете переименовали.
 */
export function buildAdCampaignNameById(
	adStats: AdDailyStats[],
): Map<string, string> {
	const nameById = new Map<string, { name: string; date: string }>();
	for (const stat of adStats) {
		if (!stat.campaignName) continue;
		const current = nameById.get(stat.campaignId);
		if (!current || stat.date >= current.date) {
			nameById.set(stat.campaignId, {
				name: stat.campaignName,
				date: stat.date,
			});
		}
	}
	return new Map([...nameById].map(([id, v]) => [id, v.name]));
}

/** undefined — источник не "yandex", либо в имени кампании нет числового ID (и нет ручной привязки), либо расход по нему не найден ("нет данных", не 0). */
export function matchAdSpend(
	source: string,
	campaignName: string,
	spendByCampaignId: Map<string, number>,
	overrides: Map<string, string> = new Map(),
): number | undefined {
	const campaignId = resolveAdCampaignId(source, campaignName, overrides);
	return campaignId ? spendByCampaignId.get(campaignId) : undefined;
}
