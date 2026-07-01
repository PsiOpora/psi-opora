import type { DealRecord, GroupStats, Summary, TrendPoint } from "./types";

export function summarize(deals: DealRecord[]): Summary {
  const wonDeals = deals.filter((d) => d.status === "won");
  const lostDeals = deals.filter((d) => d.status === "lost");
  const inProgressDeals = deals.filter((d) => d.status === "in_progress");
  const opportunitySum = deals.reduce((sum, d) => sum + d.opportunity, 0);
  const wonSum = wonDeals.reduce((sum, d) => sum + d.opportunity, 0);
  const closed = wonDeals.length + lostDeals.length;

  return {
    totalDeals: deals.length,
    wonDeals: wonDeals.length,
    lostDeals: lostDeals.length,
    inProgressDeals: inProgressDeals.length,
    opportunitySum,
    wonSum,
    conversionRate: closed > 0 ? wonDeals.length / closed : 0,
    avgDealSize: wonDeals.length > 0 ? wonSum / wonDeals.length : 0,
  };
}

function groupBy(deals: DealRecord[], keyOf: (deal: DealRecord) => string, labelOf?: (key: string) => string): GroupStats[] {
  const groups = new Map<string, DealRecord[]>();
  for (const deal of deals) {
    const key = keyOf(deal);
    const bucket = groups.get(key);
    if (bucket) bucket.push(deal);
    else groups.set(key, [deal]);
  }

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
  return stats.sort((a, b) => b.deals - a.deals);
}

export function groupByUtmSource(deals: DealRecord[]): GroupStats[] {
  return groupBy(deals, (d) => d.utmSource);
}

export function groupByUtmCampaign(deals: DealRecord[]): GroupStats[] {
  return groupBy(deals, (d) => `${d.utmSource} / ${d.utmCampaign}`);
}

export function groupBySource(deals: DealRecord[], names: Map<string, string>): GroupStats[] {
  return groupBy(
    deals,
    (d) => d.sourceId,
    (key) => names.get(key) ?? key,
  );
}

export function trendByDay(deals: DealRecord[]): TrendPoint[] {
  const byDay = new Map<string, DealRecord[]>();
  for (const deal of deals) {
    const key = deal.dateCreate.toISOString().slice(0, 10);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(deal);
    else byDay.set(key, [deal]);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, group]) => ({
      date,
      deals: group.length,
      won: group.filter((d) => d.status === "won").length,
      opportunitySum: group.reduce((sum, d) => sum + d.opportunity, 0),
    }));
}
