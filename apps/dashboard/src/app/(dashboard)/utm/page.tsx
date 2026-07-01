import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { groupByUtmCampaign, groupByUtmSource } from "@/lib/analytics/aggregate";
import { parseDateRange } from "@/lib/analytics/date-range";
import { fetchDeals } from "@/lib/analytics/deals";
import { getBitrixApi } from "@/lib/bitrix/session";
import { GroupBarChart } from "@/components/dashboard/group-bar-chart";
import { GroupStatsTable } from "@/components/dashboard/group-stats-table";
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
  const bySource = groupByUtmSource(deals);
  const byCampaign = groupByUtmCampaign(deals);

  return (
    <div className="flex flex-col gap-4">
      <GroupBarChart title="UTM source" description="Сумма выигранных сделок по источнику трафика" data={bySource} />
      <Card>
        <CardHeader>
          <CardTitle>По UTM source</CardTitle>
          <CardDescription>Разбивка сделок по utm_source за выбранный период</CardDescription>
        </CardHeader>
        <CardContent>
          <GroupStatsTable columnLabel="UTM source" data={bySource} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>По UTM source / campaign</CardTitle>
          <CardDescription>Разбивка сделок по связке utm_source + utm_campaign</CardDescription>
        </CardHeader>
        <CardContent>
          <GroupStatsTable columnLabel="UTM source / campaign" data={byCampaign} />
        </CardContent>
      </Card>
    </div>
  );
}
