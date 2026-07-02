import { groupBySource, groupByUtmSource, summarize, trendByDay } from "@/lib/analytics/aggregate";
import { parseDateRange, previousRange } from "@/lib/analytics/date-range";
import { fetchDeals, fetchSourceNames } from "@/lib/analytics/deals";
import { getBitrixApi } from "@/lib/bitrix/session";
import { GroupStatsCard } from "@/components/dashboard/group-stats-card";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { NotConnected } from "@/components/dashboard/not-connected";
import { TrendChart } from "@/components/dashboard/trend-chart";

const TOP_LIMIT = 5;

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const api = await getBitrixApi();
  if (!api) return <NotConnected />;

  const range = parseDateRange(await searchParams);
  const [deals, previousDeals, sourceNames] = await Promise.all([
    fetchDeals(api, range),
    fetchDeals(api, previousRange(range)),
    fetchSourceNames(api),
  ]);
  const summary = summarize(deals);
  const previousSummary = summarize(previousDeals);
  const trend = trendByDay(deals);
  const topUtm = groupByUtmSource(deals).slice(0, TOP_LIMIT);
  const topSources = groupBySource(deals, sourceNames).slice(0, TOP_LIMIT);

  return (
    <div className="flex flex-col gap-4">
      <KpiCards summary={summary} previous={previousSummary} />
      <TrendChart data={trend} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <GroupStatsCard
          title="Топ UTM-источников"
          description={`Топ-${TOP_LIMIT} по количеству сделок — полный разрез на странице «UTM-отчёт»`}
          columnLabel="UTM source"
          csvName="top-utm-sources.csv"
          data={topUtm}
        />
        <GroupStatsCard
          title="Топ источников CRM"
          description={`Топ-${TOP_LIMIT} по количеству сделок — полный список на странице «Источники»`}
          columnLabel="Источник"
          csvName="top-crm-sources.csv"
          data={topSources}
        />
      </div>
    </div>
  );
}
