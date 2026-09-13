import { FUNNEL_STEPS, type FunnelStep } from "@psi-opora/bot-core/funnel-steps";
import {
	getAdStatsByDateRange,
	getBotFunnelDropReasonsByDateRange,
	getBotFunnelTrendByDay,
	getBotFunnelUniqueStepCountsByDateRange,
	groupDealsBy,
} from "@psi-opora/db/queries";
import {
	type BotFunnelDropReasonRow,
	type BotFunnelEvent,
	type BotFunnelSourceRow,
	type BotFunnelTrendPoint,
	funnelBySourceCampaign,
	REASON_LABELS,
	STEP_LABELS,
} from "./bot-funnel-shared";
import { formatDateParam } from "./date-range";
import type { DateRange } from "./types";

export * from "./bot-funnel-shared";

/** Суффикс тестовой кампании: `vk_ads1_test`, `some_source_test` и т.п. — не учитывается в отчёте. */
const TEST_CAMPAIGN_SUFFIX = "_test";

/** Разделитель ключа группы в groupDealsBy("utmCampaign", ...) — chr(31), см. dimensionKeyExpr в packages/db/src/queries/deals.ts. */
const UTM_GROUP_KEY_SEPARATOR = String.fromCharCode(31);

/** Хвостовые цифры в имени кампании — это, как правило, числовой ID кампании
 * рекламного кабинета (см. packages/bot-core/src/utils/site-codes.ts, где
 * `search_anorexia_708811857` содержит Yandex CampaignId). Используем это,
 * чтобы сматчить расход из ad_daily_stats без отдельной таблицы соответствий. */
const CAMPAIGN_ID_SUFFIX_RE = /(\d{6,})$/;

const DEAL_GROUP_PAGE_SIZE = 1000;

async function fetchAllDealGroups(range: DateRange) {
	const options = { from: range.from, to: range.to };
	const firstPage = await groupDealsBy("utmCampaign", {
		...options,
		limit: DEAL_GROUP_PAGE_SIZE,
	});
	if (firstPage.rows.length >= firstPage.total) return firstPage.rows;

	const allGroups = await groupDealsBy("utmCampaign", {
		...options,
		limit: firstPage.total,
	});
	return allGroups.rows;
}

export async function fetchBotFunnelEvents(
	range: DateRange,
	options: { includeTest?: boolean } = {},
): Promise<BotFunnelEvent[]> {
	const rows = await getBotFunnelUniqueStepCountsByDateRange(
		formatDateParam(range.from),
		formatDateParam(range.to),
	);

	return rows
		.filter((row) => (FUNNEL_STEPS as readonly string[]).includes(row.step))
		.filter(
			(row) =>
				options.includeTest || !row.campaign.endsWith(TEST_CAMPAIGN_SUFFIX),
		)
		.map((row) => ({
			messenger: row.messenger,
			step: row.step as FunnelStep,
			flow: row.flow,
			source: row.source,
			campaign: row.campaign,
			count: row.uniqueUsers,
		}));
}

/** Таблица "по источникам и кампаниям", обогащённая суммой/выигрышем сделок
 * из CRM (groupDealsBy — та же группировка utm_source+utm_campaign, что и на
 * /utm) и расходом из рекламных кабинетов (ad_daily_stats, сматченным по
 * числовому ID кампании в её имени). Поля revenue/spend — undefined, если
 * для пары source/campaign нет соответствующих данных ("нет данных", а не 0). */
export async function fetchBotFunnelSourceEnriched(
	range: DateRange,
	events: BotFunnelEvent[],
): Promise<BotFunnelSourceRow[]> {
	const rows = funnelBySourceCampaign(events);
	if (rows.length === 0) return rows;

	const [dealGroups, adStats] = await Promise.all([
		fetchAllDealGroups(range),
		getAdStatsByDateRange(
			formatDateParam(range.from),
			formatDateParam(range.to),
		),
	]);

	const dealsByKey = new Map<string, (typeof dealGroups)[number]>();
	for (const group of dealGroups) {
		const [source, campaign] = group.key.split(UTM_GROUP_KEY_SEPARATOR);
		dealsByKey.set(`${source ?? ""}|${campaign ?? ""}`, group);
	}

	const spendByCampaignId = new Map<string, number>();
	for (const stat of adStats) {
		const spend = (stat.spend ?? 0) / 100;
		spendByCampaignId.set(
			stat.campaignId,
			(spendByCampaignId.get(stat.campaignId) ?? 0) + spend,
		);
	}

	return rows.map((row) => {
		const deal = dealsByKey.get(row.key);
		const campaignId = row.campaign.match(CAMPAIGN_ID_SUFFIX_RE)?.[1];
		const spend = campaignId ? spendByCampaignId.get(campaignId) : undefined;

		return {
			...row,
			wonDeals: deal?.won,
			opportunitySum: deal?.opportunitySum,
			wonSum: deal?.wonSum,
			spend,
			cpl: spend !== undefined && row.starts > 0 ? spend / row.starts : undefined,
			cac: spend !== undefined && row.deals > 0 ? spend / row.deals : undefined,
			roas:
				spend !== undefined && spend > 0 && deal?.wonSum !== undefined
					? deal.wonSum / spend
					: undefined,
		};
	});
}

export async function fetchBotFunnelTrend(
	range: DateRange,
	options: { includeTest?: boolean } = {},
): Promise<BotFunnelTrendPoint[]> {
	return getBotFunnelTrendByDay(
		formatDateParam(range.from),
		formatDateParam(range.to),
		options.includeTest,
	);
}

/** Причины, по которым пользователи не пошли дальше конкретного шага — для
 * блока "Причины отвала" (см. getBotFunnelDropReasonsByDateRange). */
export async function fetchBotFunnelDropReasons(
	range: DateRange,
): Promise<BotFunnelDropReasonRow[]> {
	const rows = await getBotFunnelDropReasonsByDateRange(
		formatDateParam(range.from),
		formatDateParam(range.to),
	);

	return rows
		.filter((row) => (FUNNEL_STEPS as readonly string[]).includes(row.step))
		.map((row) => ({
			key: `${row.messenger}|${row.flow}|${row.step}|${row.reason}`,
			messenger: row.messenger,
			flow: row.flow,
			step: row.step as FunnelStep,
			stepLabel: STEP_LABELS[row.step as FunnelStep],
			reason: row.reason,
			reasonLabel: REASON_LABELS[row.reason] ?? row.reason,
			count: row.uniqueUsers,
		}))
		.sort((a, b) => b.count - a.count);
}
