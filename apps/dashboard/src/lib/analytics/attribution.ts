import "server-only";
import {
	type ClientAcquisitionRow,
	type DealGroupStats,
	getAdCampaignIdOverrides,
	getAdStatsByDateRange,
	getClientAcquisitionByCampaign,
	getDealsSummary,
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
import { UNATTRIBUTED_KEY } from "./attribution-constants";
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
	/** Название кампании в рекламном кабинете (CampaignName из Яндекс.Директа) —
	 * подпись рядом с UTM-меткой, которая сама по себе часто нечитаема. undefined —
	 * ID кампании не определился или для него нет данных в ad_daily_stats. */
	adCampaignName?: string;
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
	overrides: Map<string, string>,
	campaignNameById: Map<string, string>,
): AttributionRow {
	const [source, campaign] = group.key.split(UTM_CAMPAIGN_KEY_SEPARATOR);
	const spend = matchAdSpend(campaign ?? "", spendByCampaignId, overrides);
	const campaignId = resolveAdCampaignId(campaign ?? "", overrides);
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
		adCampaignName: campaignId ? campaignNameById.get(campaignId) : undefined,
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
 * Расход есть в ad_daily_stats, но матчинг по числовому ID кампании в UTM
 * (ad-spend-match.ts) находит его только если ссылка/кодовое слово на сайте
 * реально содержит ID этой кампании из рекламного кабинета — если кампанию
 * пересоздали в Директе, а трекинговую ссылку не обновили, деньги реальные,
 * а привязать их к конкретному source/campaign нечем. Не прятать эту сумму
 * молча — отдельной строкой, чтобы расход не терялся ни в шапке, ни в таблице.
 */
function buildUnattributedRow(spend: number): AttributionRow {
	return {
		key: UNATTRIBUTED_KEY,
		source: NOT_SPECIFIED,
		campaign: "не привязано к UTM-кампании",
		deals: 0,
		won: 0,
		opportunitySum: 0,
		wonSum: 0,
		conversionRate: 0,
		spend,
		cpl: undefined,
		cac: undefined,
		romi: undefined,
		newClients: 0,
		newClientsRevenue: 0,
		repeatClients: 0,
		repeatRevenue: 0,
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
	const [
		dealGroups,
		adStats,
		dealsSummary,
		clientAcquisitionRows,
		overrideRows,
	] = await Promise.all([
		fetchAllDealGroups(range),
		getAdStatsByDateRange(
			formatDateParam(range.from),
			formatDateParam(range.to),
		),
		getDealsSummary({ from: range.from, to: range.to }),
		getClientAcquisitionByCampaign(range),
		getAdCampaignIdOverrides(),
	]);

	const spendByCampaignId = aggregateAdSpendByCampaignId(adStats);
	const campaignNameById = buildAdCampaignNameById(adStats);
	const overrides = buildAdCampaignIdOverridesMap(overrideRows);
	const clientAcquisitionByKey = new Map(
		clientAcquisitionRows.map((row) => [row.key, row]),
	);
	const rows = dealGroups.map((group) =>
		toRow(
			group,
			spendByCampaignId,
			clientAcquisitionByKey,
			overrides,
			campaignNameById,
		),
	);

	// Реальный итог по расходу — сумма всего ad_daily_stats за период, а не
	// только строк, которые удалось привязать к UTM (иначе шапка отчёта тоже
	// молча теряет деньги, которые не сматчились ни с одной кампанией).
	const totalAdSpend = [...spendByCampaignId.values()].reduce(
		(sum, spend) => sum + spend,
		0,
	);
	const matchedCampaignIds = new Set(
		dealGroups.flatMap((group) => {
			const [, campaign] = group.key.split(UTM_CAMPAIGN_KEY_SEPARATOR);
			const campaignId = resolveAdCampaignId(campaign ?? "", overrides);
			return campaignId && spendByCampaignId.has(campaignId)
				? [campaignId]
				: [];
		}),
	);
	const matchedSpend = [...matchedCampaignIds].reduce(
		(sum, campaignId) => sum + (spendByCampaignId.get(campaignId) ?? 0),
		0,
	);
	const unattributedSpend = totalAdSpend - matchedSpend;
	if (unattributedSpend > 0.5) {
		rows.push(buildUnattributedRow(unattributedSpend));
	}
	rows.sort((a, b) => {
		if (a.key === UNATTRIBUTED_KEY) {
			return b.key === UNATTRIBUTED_KEY ? 0 : 1;
		}
		if (b.key === UNATTRIBUTED_KEY) {
			return -1;
		}
		return (b.spend ?? 0) - (a.spend ?? 0) || b.wonSum - a.wonSum;
	});

	const summary: AttributionSummary = {
		totalDeals: dealsSummary.totalDeals,
		totalWon: dealsSummary.wonDeals,
		totalOpportunitySum: dealsSummary.opportunitySum,
		totalWonSum: dealsSummary.wonSum,
		conversionRate: dealsSummary.conversionRate,
		totalSpend: totalAdSpend,
		romi:
			totalAdSpend > 0
				? (dealsSummary.wonSum - totalAdSpend) / totalAdSpend
				: null,
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
