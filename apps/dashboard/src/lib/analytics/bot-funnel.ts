import {
	FUNNEL_STEPS,
	type FunnelStep,
} from "@psi-opora/bot-core/funnel-steps";
import {
	getAdCampaignIdOverrides,
	getAdStatsByDateRange,
	getBotFunnelDropReasonsByDateRange,
	getBotFunnelTrendByDay,
	getBotFunnelUniqueStepCountsByDateRange,
} from "@psi-opora/db/queries";
import { UTM_CAMPAIGN_KEY_SEPARATOR } from "@/lib/constants/separators";
import {
	aggregateAdSpendByCampaignId,
	buildAdCampaignIdOverridesMap,
	buildAdCampaignNameById,
	matchAdSpend,
	resolveAdCampaignId,
} from "./ad-spend-match";
import { fetchAllDealGroups } from "./all-deal-groups";
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

	const [dealGroups, adStats, overrideRows] = await Promise.all([
		fetchAllDealGroups(range),
		getAdStatsByDateRange(
			formatDateParam(range.from),
			formatDateParam(range.to),
		),
		getAdCampaignIdOverrides(),
	]);

	const dealsByKey = new Map<string, (typeof dealGroups)[number]>();
	for (const group of dealGroups) {
		const [source, campaign] = group.key.split(UTM_CAMPAIGN_KEY_SEPARATOR);
		dealsByKey.set(`${source ?? ""}|${campaign ?? ""}`, group);
	}

	const spendByCampaignId = aggregateAdSpendByCampaignId(adStats);
	const campaignNameById = buildAdCampaignNameById(adStats);
	const overrides = buildAdCampaignIdOverridesMap(overrideRows);

	return rows.map((row) => {
		const deal = dealsByKey.get(row.key);
		const spend = matchAdSpend(row.campaign, spendByCampaignId, overrides);
		const campaignId = resolveAdCampaignId(row.campaign, overrides);

		return {
			...row,
			wonDeals: deal?.won,
			opportunitySum: deal?.opportunitySum,
			wonSum: deal?.wonSum,
			spend,
			adCampaignName: campaignId ? campaignNameById.get(campaignId) : undefined,
			cpl:
				spend !== undefined && row.starts > 0 ? spend / row.starts : undefined,
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
