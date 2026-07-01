"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import type { GroupStats } from "@/lib/analytics/types";

const chartConfig = {
  wonSum: { label: "Сумма выигранных", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function GroupBarChart({
  title,
  description,
  data,
}: {
  title: string;
  description: string;
  data: GroupStats[];
}) {
  const top = data.slice(0, 8);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[320px] w-full">
          <BarChart data={top} layout="vertical" margin={{ left: 16 }}>
            <CartesianGrid horizontal={false} />
            <XAxis type="number" tickLine={false} axisLine={false} />
            <YAxis
              dataKey="label"
              type="category"
              tickLine={false}
              axisLine={false}
              width={140}
              tickFormatter={(value: string) => (value.length > 20 ? `${value.slice(0, 20)}…` : value)}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="wonSum" fill="var(--color-wonSum)" radius={4} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
