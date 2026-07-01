import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Summary } from "@/lib/analytics/types";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";

export function KpiCards({ summary }: { summary: Summary }) {
  const items = [
    {
      label: "Всего сделок",
      value: formatNumber(summary.totalDeals),
      hint: `${formatNumber(summary.inProgressDeals)} в работе`,
    },
    {
      label: "Выиграно сделок",
      value: formatNumber(summary.wonDeals),
      hint: `Конверсия ${formatPercent(summary.conversionRate)}`,
    },
    {
      label: "Сумма выигранных",
      value: formatMoney(summary.wonSum),
      hint: `Средний чек ${formatMoney(summary.avgDealSize)}`,
    },
    {
      label: "Сумма в воронке",
      value: formatMoney(summary.opportunitySum),
      hint: `${formatNumber(summary.lostDeals)} проиграно`,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label}>
          <CardHeader>
            <CardDescription>{item.label}</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{item.value}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">{item.hint}</CardContent>
        </Card>
      ))}
    </div>
  );
}
