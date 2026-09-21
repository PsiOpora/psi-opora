import {
	type ClientAcquisitionRow,
	type DealGroupStats,
	getAdStatsByDateRange,
	getClientAcquisitionByCampaign,
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
	/** Сколько клиентов этой группы обратились впервые за всю историю (не только за период) — сумма revenue считает только их первую сделку и только выигранную. */
	newClients: number;
	newClientsRevenue: number;
	/** Клиенты с более ранней сделкой (любой, не обязательно выигранной) — revenue считает их сделки за период, тоже только выигранные. */
	repeatClients: number;
	repeatRevenue: number;
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
	totalNewClients: number;
	totalNewClientsRevenue: number;
	totalRepeatClients: number;
	totalRepeatRevenue: number;
}

const EMPTY_CLIENT_ACQUISITION: Omit<ClientAcquisitionRow, "key"> = {
	newClients: 0,
	newClientsRevenue: 0,
	repeatClients: 0,
	repeatRevenue: 0,
};

function toRow(
	group: DealGroupStats,
	spendByCampaignId: Map<string, number>,
	clientAcquisitionByKey: Map<string, ClientAcquisitionRow>,
): AttributionRow {
	const [source, campaign] = group.key.split(UTM_CAMPAIGN_KEY_SEPARATOR);
	const spend = matchAdSpend(campaign ?? "", spendByCampaignId);
	const acquisition =
		clientAcquisitionByKey.get(group.key) ?? EMPTY_CLIENT_ACQUISITION;
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
		newClients: acquisition.newClients,
		newClientsRevenue: acquisition.newClientsRevenue,
		repeatClients: acquisition.repeatClients,
		repeatRevenue: acquisition.repeatRevenue,
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
	const [dealGroups, adStats, dealsSummary, clientAcquisitionRows] =
		await Promise.all([
			fetchAllDealGroups(range),
			getAdStatsByDateRange(
				formatDateParam(range.from),
				formatDateParam(range.to),
			),
			getDealsSummary({ from: range.from, to: range.to }),
			getClientAcquisitionByCampaign(range),
		]);

	const spendByCampaignId = aggregateAdSpendByCampaignId(adStats);
	const clientAcquisitionByKey = new Map(
		clientAcquisitionRows.map((row) => [row.key, row]),
	);
	const rows = dealGroups
		.map((group) => toRow(group, spendByCampaignId, clientAcquisitionByKey))
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
		totalNewClients: rows.reduce((sum, row) => sum + row.newClients, 0),
		totalNewClientsRevenue: rows.reduce(
			(sum, row) => sum + row.newClientsRevenue,
			0,
		),
		totalRepeatClients: rows.reduce((sum, row) => sum + row.repeatClients, 0),
		totalRepeatRevenue: rows.reduce((sum, row) => sum + row.repeatRevenue, 0),
	};

	return { rows, summary };
}
