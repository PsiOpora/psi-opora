import { summarize, trendByDay } from "@/lib/analytics/aggregate";
import { parseDateRange } from "@/lib/analytics/date-range";
import { fetchDeals } from "@/lib/analytics/deals";
import { getBitrixApi } from "@/lib/bitrix/session";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { NotConnected } from "@/components/dashboard/not-connected";
import { TrendChart } from "@/components/dashboard/trend-chart";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const api = await getBitrixApi();
  if (!api) return <NotConnected />;

  const range = parseDateRange(await searchParams);
  const deals = await fetchDeals(api, range);
  const summary = summarize(deals);
  const trend = trendByDay(deals);

  return (
    <div className="flex flex-col gap-4">
      <KpiCards summary={summary} />
      <TrendChart data={trend} />
    </div>
  );
}
