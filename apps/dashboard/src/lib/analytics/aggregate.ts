import type {
  DealRecord,
  FunnelStage,
  GroupStats,
  Summary,
  TrendPoint,
} from "./types";
import type { StageInfo } from "./deals";

const DAY_MS = 24 * 60 * 60 * 1000;

export function summarize(deals: DealRecord[]): Summary {
  const wonDeals = deals.filter((d) => d.status === "won");
  const lostDeals = deals.filter((d) => d.status === "lost");
  const inProgressDeals = deals.filter((d) => d.status === "in_progress");
  const opportunitySum = deals.reduce((sum, d) => sum + d.opportunity, 0);
  const wonSum = wonDeals.reduce((sum, d) => sum + d.opportunity, 0);
  const closed = wonDeals.length + lostDeals.length;
  const cycles = wonDeals
    .filter((d) => d.closeDate)
    .map((d) => (d.closeDate?.getTime() - d.dateCreate.getTime()) / DAY_MS);

  return {
    totalDeals: deals.length,
    wonDeals: wonDeals.length,
    lostDeals: lostDeals.length,
    inProgressDeals: inProgressDeals.length,
    opportunitySum,
    wonSum,
    conversionRate: closed > 0 ? wonDeals.length / closed : 0,
    avgDealSize: wonDeals.length > 0 ? wonSum / wonDeals.length : 0,
    avgCycleDays:
      cycles.length > 0
        ? cycles.reduce((sum, d) => sum + d, 0) / cycles.length
        : 0,
  };
}

export function bucketBy(
  deals: DealRecord[],
  keyOf: (deal: DealRecord) => string,
): Map<string, DealRecord[]> {
  const groups = new Map<string, DealRecord[]>();
  for (const deal of deals) {
    const key = keyOf(deal);
    const bucket = groups.get(key);
    if (bucket) bucket.push(deal);
    else groups.set(key, [deal]);
  }
  return groups;
}

export function computeGroupStats(
  groups: Map<string, DealRecord[]>,
  labelOf?: (key: string) => string,
): GroupStats[] {
  const stats: GroupStats[] = [];
  for (const [key, group] of groups) {
    const won = group.filter((d) => d.status === "won");
    const lost = group.filter((d) => d.status === "lost");
    const closed = won.length + lost.length;
    const opportunitySum = group.reduce((sum, d) => sum + d.opportunity, 0);
    const wonSum = won.reduce((sum, d) => sum + d.opportunity, 0);
    stats.push({
      key,
      label: labelOf ? labelOf(key) : key,
      deals: group.length,
      won: won.length,
      opportunitySum,
      wonSum,
      conversionRate: closed > 0 ? won.length / closed : 0,
    });
  }
  return stats;
}

function groupBy(
  deals: DealRecord[],
  keyOf: (deal: DealRecord) => string,
  labelOf?: (key: string) => string,
): GroupStats[] {
  return computeGroupStats(bucketBy(deals, keyOf), labelOf).sort(
    (a, b) => b.deals - a.deals,
  );
}

export function groupByUtmSource(deals: DealRecord[]): GroupStats[] {
  return groupBy(deals, (d) => d.utmSource);
}

export function groupByUtmCampaign(deals: DealRecord[]): GroupStats[] {
  return groupBy(deals, (d) => `${d.utmSource} / ${d.utmCampaign}`);
}

export function groupByUtmMedium(deals: DealRecord[]): GroupStats[] {
  return groupBy(deals, (d) => d.utmMedium);
}

export function groupByUtmContent(deals: DealRecord[]): GroupStats[] {
  return groupBy(deals, (d) => d.utmContent);
}

export function groupByUtmTerm(deals: DealRecord[]): GroupStats[] {
  return groupBy(deals, (d) => d.utmTerm);
}

export function groupBySource(
  deals: DealRecord[],
  names: Map<string, string>,
): GroupStats[] {
  return groupBy(
    deals,
    (d) => d.sourceId,
    (key) => names.get(key) ?? key,
  );
}

/** Разбивка сделок одной воронки по стадиям в порядке SORT справочника стадий. */
export function funnelByStage(
  deals: DealRecord[],
  stages: Map<string, StageInfo>,
): FunnelStage[] {
  const byStage = bucketBy(deals, (d) => d.stageId);
  const total = deals.length;
  return [...byStage.entries()]
    .map(([stageId, group]) => ({
      stageId,
      label: stages.get(stageId)?.name ?? stageId,
      deals: group.length,
      opportunitySum: group.reduce((sum, d) => sum + d.opportunity, 0),
      share: total > 0 ? group.length / total : 0,
    }))
    .sort(
      (a, b) =>
        (stages.get(a.stageId)?.sort ?? Number.MAX_SAFE_INTEGER) -
        (stages.get(b.stageId)?.sort ?? Number.MAX_SAFE_INTEGER),
    );
}

export function groupDealsByCategory(
  deals: DealRecord[],
): Map<string, DealRecord[]> {
  return bucketBy(deals, (d) => d.categoryId);
}

export function trendByDay(deals: DealRecord[]): TrendPoint[] {
  const byDay = bucketBy(deals, (d) => d.dateCreate.toISOString().slice(0, 10));

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, group]) => ({
      date,
      deals: group.length,
      won: group.filter((d) => d.status === "won").length,
      opportunitySum: group.reduce((sum, d) => sum + d.opportunity, 0),
    }));
}
