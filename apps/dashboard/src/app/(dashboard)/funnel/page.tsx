"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { funnelByStage, groupDealsByCategory } from "@/lib/analytics/aggregate";
import { useBitrixData } from "@/hooks/use-bitrix-data";
import { FunnelStages } from "@/components/dashboard/funnel-stages";
import { NotConnected } from "@/components/dashboard/not-connected";

export default function FunnelPage() {
  const { data, isLoading, isError } = useBitrixData([
    "deals",
    "stageNames",
    "categoryNames",
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
  const stageNames = data.stageNames ?? new Map();
  const categoryNames = data.categoryNames ?? new Map();

  const byCategory = [...groupDealsByCategory(deals).entries()].sort(
    ([, a], [, b]) => b.length - a.length,
  );

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
            <CardTitle>
              {categoryNames.get(categoryId) ?? `Воронка ${categoryId}`}
            </CardTitle>
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
