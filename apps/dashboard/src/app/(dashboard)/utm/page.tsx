"use client";

import { GroupBarChart } from "@/components/dashboard/group-bar-chart";
import { GroupStatsCard } from "@/components/dashboard/group-stats-card";
import { NotConnected } from "@/components/dashboard/not-connected";
import { PageSuspense } from "@/components/dashboard/page-suspense";
import { UtmLegendCard } from "@/components/dashboard/utm-legend-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBitrixData } from "@/hooks/use-bitrix-data";
import {
  groupByUtmCampaign,
  groupByUtmContent,
  groupByUtmMedium,
  groupByUtmSource,
  groupByUtmTerm,
} from "@/lib/analytics/aggregate";
import { utmHint } from "@/lib/analytics/utm-tags";

export default function UtmReportPage() {
  return (
    <PageSuspense>
      <UtmReportPageContent />
    </PageSuspense>
  );
}

function UtmReportPageContent() {
  const { data, isLoading, isError } = useBitrixData(["deals", "dealDomain"]);

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
  const dealDomain = data.dealDomain ?? null;

  const dimensions = [
    {
      value: "source",
      tab: "Source",
      columnLabel: "UTM source",
      description: "Разбивка сделок по utm_source за выбранный период",
      hint: utmHint("utm_source"),
      data: groupByUtmSource(deals),
    },
    {
      value: "medium",
      tab: "Medium",
      columnLabel: "UTM medium",
      description: "Разбивка сделок по типу трафика (utm_medium)",
      hint: utmHint("utm_medium"),
      data: groupByUtmMedium(deals),
    },
    {
      value: "campaign",
      tab: "Campaign",
      columnLabel: "UTM source / campaign",
      description: "Разбивка сделок по связке utm_source + utm_campaign",
      hint: `Комбинация источника и названия кампании — так проще сравнивать одинаковые кампании, запущенные в разных источниках. ${utmHint("utm_campaign")}`,
      data: groupByUtmCampaign(deals),
    },
    {
      value: "content",
      tab: "Content",
      columnLabel: "UTM content",
      description: "Разбивка сделок по объявлению/креативу (utm_content)",
      hint: utmHint("utm_content"),
      data: groupByUtmContent(deals),
    },
    {
      value: "term",
      tab: "Term",
      columnLabel: "UTM term",
      description: "Разбивка сделок по ключевой фразе (utm_term)",
      hint: utmHint("utm_term"),
      data: groupByUtmTerm(deals),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <UtmLegendCard />
      <Tabs defaultValue="source" className="flex flex-col gap-4">
        <TabsList>
          {dimensions.map((dim) => (
            <TabsTrigger key={dim.value} value={dim.value}>
              {dim.tab}
            </TabsTrigger>
          ))}
        </TabsList>
        {dimensions.map((dim) => (
          <TabsContent
            key={dim.value}
            value={dim.value}
            className="flex flex-col gap-4"
          >
            <GroupBarChart
              title={dim.columnLabel}
              description={`Сумма выигранных сделок — ${dim.tab.toLowerCase()}`}
              hint={dim.hint}
              data={dim.data}
            />
            <GroupStatsCard
              title={`По ${dim.columnLabel}`}
              description={dim.description}
              hint={dim.hint}
              columnLabel={dim.columnLabel}
              csvName={`utm-${dim.value}.csv`}
              data={dim.data}
              dealDomain={dealDomain}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
