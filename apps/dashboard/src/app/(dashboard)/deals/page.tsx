import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { parseDateRange } from "@/lib/analytics/date-range";
import { fetchDeals } from "@/lib/analytics/deals";
import { getBitrixApi } from "@/lib/bitrix/session";
import { DealsTable } from "@/components/dashboard/deals-table";
import { NotConnected } from "@/components/dashboard/not-connected";

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const api = await getBitrixApi();
  if (!api) return <NotConnected />;

  const range = parseDateRange(await searchParams);
  const deals = await fetchDeals(api, range);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Сделки</CardTitle>
        <CardDescription>{deals.length} сделок за выбранный период</CardDescription>
      </CardHeader>
      <CardContent>
        <DealsTable deals={deals} />
      </CardContent>
    </Card>
  );
}
