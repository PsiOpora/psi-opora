import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { funnelByStage, groupDealsByCategory } from "@/lib/analytics/aggregate";
import { parseDateRange } from "@/lib/analytics/date-range";
import { fetchCategoryNames, fetchDeals, fetchStageNames } from "@/lib/analytics/deals";
import { getBitrixApi } from "@/lib/bitrix/session";
import { FunnelStages } from "@/components/dashboard/funnel-stages";
import { NotConnected } from "@/components/dashboard/not-connected";

export default async function FunnelPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const api = await getBitrixApi();
  if (!api) return <NotConnected />;

  const range = parseDateRange(await searchParams);
  const [deals, stageNames, categoryNames] = await Promise.all([
    fetchDeals(api, range),
    fetchStageNames(api),
    fetchCategoryNames(api),
  ]);

  const byCategory = [...groupDealsByCategory(deals).entries()].sort(([, a], [, b]) => b.length - a.length);

  if (byCategory.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Воронка продаж</CardTitle>
          <CardDescription>Нет сделок за выбранный период</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {byCategory.map(([categoryId, categoryDeals]) => (
        <Card key={categoryId}>
          <CardHeader>
            <CardTitle>{categoryNames.get(categoryId) ?? `Воронка ${categoryId}`}</CardTitle>
            <CardDescription>
              Стадии сделок, созданных за период · {categoryDeals.length} сделок
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FunnelStages stages={funnelByStage(categoryDeals, stageNames)} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
