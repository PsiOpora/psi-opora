"use client";

import {
  groupBySource,
  groupByUtmSource,
  summarize,
  trendByDay,
} from "@/lib/analytics/aggregate";
import { useBitrixData } from "@/hooks/use-bitrix-data";
import { GroupStatsCard } from "@/components/dashboard/group-stats-card";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { NotConnected } from "@/components/dashboard/not-connected";
import { PageSuspense } from "@/components/dashboard/page-suspense";
import { TrendChart } from "@/components/dashboard/trend-chart";

const TOP_LIMIT = 5;

export default function OverviewPage() {
  return (
    <PageSuspense>
      <OverviewPageContent />
    </PageSuspense>
  );
}

function OverviewPageContent() {
  const { data, isLoading, isError } = useBitrixData([
    "deals",
    "previousDeals",
    "sourceNames",
    "dealDomain",
  ]);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Загрузка…</p>;
  }
  if (isError) {
    return (
      <p className="text-sm text-destructive">
        Не удалось загрузить данные. Попробуйте обновить страницу.
      </p>
    );
  }
  if (!data?.connected) return <NotConnected />;

  const deals = data.deals ?? [];
  const previousDeals = data.previousDeals ?? [];
  const sourceNames = data.sourceNames ?? new Map<string, string>();
  const dealDomain = data.dealDomain ?? null;

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
          dealDomain={dealDomain}
        />
        <GroupStatsCard
          title="Топ источников CRM"
          description={`Топ-${TOP_LIMIT} по количеству сделок — полный список на странице «Источники»`}
          columnLabel="Источник"
          csvName="top-crm-sources.csv"
          data={topSources}
          dealDomain={dealDomain}
        />
      </div>
    </div>
  );
}
