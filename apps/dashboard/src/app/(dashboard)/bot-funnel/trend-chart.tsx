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
import type { BotFunnelTrendPoint } from "@/lib/analytics/bot-funnel-shared";

const chartConfig = {
	starts: { label: "Стартов", color: "var(--chart-1)" },
	deals: { label: "Заявок", color: "var(--chart-2)" },
} satisfies ChartConfig;

export function BotFunnelTrendChart({ data }: { data: BotFunnelTrendPoint[] }) {
	if (data.length === 0) {
		return (
			<p className="py-8 text-center text-sm text-muted-foreground">
				Нет данных за выбранный период.
			</p>
		);
	}
	return (
		<Card>
			<CardHeader>
				<CardTitle>Динамика по дням</CardTitle>
				<CardDescription>
					Уникальные пользователи, запустившие бота, и заявки в CRM — по дням
				</CardDescription>
			</CardHeader>
			<CardContent>
				<ChartContainer config={chartConfig} className="h-[260px] w-full">
					<AreaChart data={data}>
						<CartesianGrid vertical={false} />
						<XAxis
							dataKey="day"
							tickLine={false}
							axisLine={false}
							tickMargin={8}
							tickFormatter={(value: string) => value.slice(5)}
						/>
						<YAxis tickLine={false} axisLine={false} width={32} />
						<ChartTooltip content={<ChartTooltipContent />} />
						<Area
							dataKey="starts"
							type="monotone"
							fill="var(--color-starts)"
							fillOpacity={0.2}
							stroke="var(--color-starts)"
						/>
						<Area
							dataKey="deals"
							type="monotone"
							fill="var(--color-deals)"
							fillOpacity={0.4}
							stroke="var(--color-deals)"
						/>
					</AreaChart>
				</ChartContainer>
			</CardContent>
		</Card>
	);
}
