"use client";

import { GroupBarChart } from "@/components/dashboard/group-bar-chart";
import { GroupStatsCard } from "@/components/dashboard/group-stats-card";
import { NotConnected } from "@/components/dashboard/not-connected";
import { PageSuspense } from "@/components/dashboard/page-suspense";
import { useBitrixData } from "@/hooks/use-bitrix-data";
import { groupBySource } from "@/lib/analytics/aggregate";

export default function SourcesPage() {
  return (
    <PageSuspense>
      <SourcesPageContent />
    </PageSuspense>
  );
}

function SourcesPageContent() {
  const { data, isLoading, isError } = useBitrixData([
    "deals",
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
  const sourceNames = data.sourceNames ?? new Map<string, string>();
  const dealDomain = data.dealDomain ?? null;
  const bySource = groupBySource(deals, sourceNames);

  return (
    <div className="flex flex-col gap-4">
      <GroupBarChart
        title="Источники CRM"
        description="Сумма выигранных сделок по источнику (SOURCE_ID)"
        data={bySource}
      />
      <GroupStatsCard
        title="По источникам"
        description="Справочник источников CRM (Приложения → CRM → Настройки → Источники)"
        columnLabel="Источник"
        csvName="crm-sources.csv"
        data={bySource}
        dealDomain={dealDomain}
      />
    </div>
  );
}
