import {
	type DealGroupStats,
	getAdStatsByDateRange,
	getDealsSummary,
} from "@psi-opora/db/queries";
import { UTM_CAMPAIGN_KEY_SEPARATOR } from "@/lib/constants/separators";
import { aggregateAdSpendByCampaignId, matchAdSpend } from "./ad-spend-match";
import { fetchAllDealGroups } from "./all-deal-groups";
import { formatDateParam } from "./date-range";
import type { DateRange } from "./types";

const NOT_SPECIFIED = "(не указано)";

export interface AttributionRow {
	key: string;
	source: string;
	campaign: string;
	deals: number;
	won: number;
	opportunitySum: number;
	wonSum: number;
	conversionRate: number;
	/** undefined — расход не удалось сматчить с кампанией (см. ad-spend-match.ts), не 0. */
	spend?: number;
	cpl?: number;
	cac?: number;
	romi?: number;
}

export interface AttributionSummary {
	totalDeals: number;
	totalWon: number;
	totalOpportunitySum: number;
	totalWonSum: number;
	conversionRate: number;
	totalSpend: number;
	/** null — расход ни по одной кампании не найден (не с чем считать ROMI). */
	romi: number | null;
}

function toRow(
	group: DealGroupStats,
	spendByCampaignId: Map<string, number>,
): AttributionRow {
	const [source, campaign] = group.key.split(UTM_CAMPAIGN_KEY_SEPARATOR);
	const spend = matchAdSpend(campaign ?? "", spendByCampaignId);
	return {
		key: group.key,
		source: source || NOT_SPECIFIED,
		campaign: campaign || NOT_SPECIFIED,
		deals: group.deals,
		won: group.won,
		opportunitySum: group.opportunitySum,
		wonSum: group.wonSum,
		conversionRate: group.conversionRate,
		spend,
		cpl:
			spend !== undefined && group.deals > 0 ? spend / group.deals : undefined,
		cac: spend !== undefined && group.won > 0 ? spend / group.won : undefined,
		romi:
			spend !== undefined && spend > 0
				? (group.wonSum - spend) / spend
				: undefined,
	};
}

/**
 * Отчёт «источник → кампания → деньги»: та же группировка
 * utm_source+utm_campaign, что и на /utm (groupDealsBy), обогащённая
 * автоматическим расходом из ad_daily_stats (см. ad-spend-match.ts —
 * сопоставление по числовому ID кампании в её названии, та же логика,
 * что и в /bot-funnel).
 */
export async function fetchAttributionReport(
	range: DateRange,
): Promise<{ rows: AttributionRow[]; summary: AttributionSummary }> {
	const [dealGroups, adStats, dealsSummary] = await Promise.all([
		fetchAllDealGroups(range),
		getAdStatsByDateRange(
			formatDateParam(range.from),
			formatDateParam(range.to),
		),
		getDealsSummary({ from: range.from, to: range.to }),
	]);

	const spendByCampaignId = aggregateAdSpendByCampaignId(adStats);
	const rows = dealGroups
		.map((group) => toRow(group, spendByCampaignId))
		.sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0) || b.wonSum - a.wonSum);

	const totalSpend = rows.reduce((sum, row) => sum + (row.spend ?? 0), 0);
	const summary: AttributionSummary = {
		totalDeals: dealsSummary.totalDeals,
		totalWon: dealsSummary.wonDeals,
		totalOpportunitySum: dealsSummary.opportunitySum,
		totalWonSum: dealsSummary.wonSum,
		conversionRate: dealsSummary.conversionRate,
		totalSpend,
		romi:
			totalSpend > 0 ? (dealsSummary.wonSum - totalSpend) / totalSpend : null,
	};

	return { rows, summary };
}
