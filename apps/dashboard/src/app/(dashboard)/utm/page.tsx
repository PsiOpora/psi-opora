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
import { utmHint } from "@/lib/analytics/utm-tags";
import { getBitrixApi } from "@/lib/bitrix/session";
import { GroupBarChart } from "@/components/dashboard/group-bar-chart";
import { GroupStatsCard } from "@/components/dashboard/group-stats-card";
import { NotConnected } from "@/components/dashboard/not-connected";
import { UtmLegendCard } from "@/components/dashboard/utm-legend-card";

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
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
