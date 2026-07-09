"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { TrendPoint } from "@/lib/analytics/types";

const chartConfig = {
  deals: { label: "Сделки", color: "var(--chart-1)" },
  won: { label: "Выиграно", color: "var(--chart-2)" },
} satisfies ChartConfig;

export function TrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Динамика сделок</CardTitle>
        <CardDescription>
          Количество новых и выигранных сделок по дням
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[300px] w-full">
          <AreaChart data={data}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(value: string) => value.slice(5)}
            />
            <YAxis tickLine={false} axisLine={false} width={32} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Area
              dataKey="deals"
              type="monotone"
              fill="var(--color-deals)"
              fillOpacity={0.2}
              stroke="var(--color-deals)"
            />
            <Area
              dataKey="won"
              type="monotone"
              fill="var(--color-won)"
              fillOpacity={0.4}
              stroke="var(--color-won)"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
