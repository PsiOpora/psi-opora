import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { groupBySource } from "@/lib/analytics/aggregate";
import { parseDateRange } from "@/lib/analytics/date-range";
import { fetchDeals, fetchSourceNames } from "@/lib/analytics/deals";
import { getBitrixApi } from "@/lib/bitrix/session";
import { GroupBarChart } from "@/components/dashboard/group-bar-chart";
import { GroupStatsTable } from "@/components/dashboard/group-stats-table";
import { NotConnected } from "@/components/dashboard/not-connected";

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const api = await getBitrixApi();
  if (!api) return <NotConnected />;

  const range = parseDateRange(await searchParams);
  const [deals, sourceNames] = await Promise.all([fetchDeals(api, range), fetchSourceNames(api)]);
  const bySource = groupBySource(deals, sourceNames);

  return (
    <div className="flex flex-col gap-4">
      <GroupBarChart title="Источники CRM" description="Сумма выигранных сделок по источнику (SOURCE_ID)" data={bySource} />
      <Card>
        <CardHeader>
          <CardTitle>По источникам</CardTitle>
          <CardDescription>Справочник источников CRM (Приложения → CRM → Настройки → Источники)</CardDescription>
        </CardHeader>
        <CardContent>
          <GroupStatsTable columnLabel="Источник" data={bySource} />
        </CardContent>
      </Card>
    </div>
  );
}
