"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useBitrixData } from "@/hooks/use-bitrix-data";
import { DealsTable } from "@/components/dashboard/deals-table";
import { NotConnected } from "@/components/dashboard/not-connected";
import { PageSuspense } from "@/components/dashboard/page-suspense";

export default function DealsPage() {
  return (
    <PageSuspense>
      <DealsPageContent />
    </PageSuspense>
  );
}

function DealsPageContent() {
  const { data, isLoading, isError } = useBitrixData(["deals"]);

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Сделки</CardTitle>
        <CardDescription>
          {deals.length} сделок за выбранный период
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DealsTable deals={deals} />
      </CardContent>
    </Card>
  );
}
