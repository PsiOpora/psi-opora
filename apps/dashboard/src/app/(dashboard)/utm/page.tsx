import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  groupByUtmCampaign,
  groupByUtmContent,
  groupByUtmMedium,
  groupByUtmSource,
  groupByUtmTerm,
} from "@/lib/analytics/aggregate";
import { parseDateRange } from "@/lib/analytics/date-range";
import { fetchDeals } from "@/lib/analytics/deals";
import { getBitrixApi } from "@/lib/bitrix/session";
import { GroupBarChart } from "@/components/dashboard/group-bar-chart";
import { GroupStatsCard } from "@/components/dashboard/group-stats-card";
import { NotConnected } from "@/components/dashboard/not-connected";

export default async function UtmReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const api = await getBitrixApi();
  if (!api) return <NotConnected />;

  const range = parseDateRange(await searchParams);
  const deals = await fetchDeals(api, range);

  const dimensions = [
    {
      value: "source",
      tab: "Source",
      columnLabel: "UTM source",
      description: "Разбивка сделок по utm_source за выбранный период",
      data: groupByUtmSource(deals),
    },
    {
      value: "medium",
      tab: "Medium",
      columnLabel: "UTM medium",
      description: "Разбивка сделок по типу трафика (utm_medium)",
      data: groupByUtmMedium(deals),
    },
    {
      value: "campaign",
      tab: "Campaign",
      columnLabel: "UTM source / campaign",
      description: "Разбивка сделок по связке utm_source + utm_campaign",
      data: groupByUtmCampaign(deals),
    },
    {
      value: "content",
      tab: "Content",
      columnLabel: "UTM content",
      description: "Разбивка сделок по объявлению/креативу (utm_content)",
      data: groupByUtmContent(deals),
    },
    {
      value: "term",
      tab: "Term",
      columnLabel: "UTM term",
      description: "Разбивка сделок по ключевой фразе (utm_term)",
      data: groupByUtmTerm(deals),
    },
  ];

  return (
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
            data={dim.data}
          />
          <GroupStatsCard
            title={`По ${dim.columnLabel}`}
            description={dim.description}
            columnLabel={dim.columnLabel}
            csvName={`utm-${dim.value}.csv`}
            data={dim.data}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}
