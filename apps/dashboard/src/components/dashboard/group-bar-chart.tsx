"use client";

import { CircleDollarSignIcon } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
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
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { InfoHint } from "./info-hint";

const chartConfig = {
	deals: { label: "Количество сделок", color: "var(--chart-1)" },
	opportunitySum: { label: "Сумма в воронке", color: "var(--chart-2)" },
	wonSum: { label: "Сумма выигранных", color: "var(--chart-1)" },
} satisfies ChartConfig;

type GroupChartMetric = "deals" | "opportunitySum" | "wonSum";

interface GroupChartRow {
	key: string;
	label: string;
	deals: number;
	opportunitySum: number;
	wonSum: number;
}

/**
 * Данные уже отсортированы и ограничены (топ-8 по нужной метрике) на
 * сервере (см. hooks/use-deals-report.ts) — компонент только рендерит, без
 * повторной сортировки/среза на клиенте.
 */
export function GroupBarChart({
	title,
	description,
	hint,
	data,
	metric = "wonSum",
}: {
	title: string;
	description: string;
	hint?: string;
	data: GroupChartRow[];
	metric?: GroupChartMetric;
}) {
	const top = data.filter((row) => metric === "deals" || row[metric] > 0);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-1.5">
					{title}
					{hint && <InfoHint text={hint} />}
				</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent>
				{top.length > 0 ? (
					<ChartContainer config={chartConfig} className="h-[320px] w-full">
						<BarChart
							accessibilityLayer
							data={top}
							layout="vertical"
							margin={{ left: 16 }}
						>
							<CartesianGrid horizontal={false} />
							<XAxis
								type="number"
								tickLine={false}
								axisLine={false}
								tickFormatter={
									metric === "deals" ? undefined : formatCompactMoney
								}
							/>
							<YAxis
								dataKey="label"
								type="category"
								tickLine={false}
								axisLine={false}
								width={140}
								tickFormatter={(value: string) =>
									value.length > 20 ? `${value.slice(0, 20)}…` : value
								}
							/>
							<ChartTooltip content={<ChartTooltipContent />} />
							<Bar
								dataKey={metric}
								fill={`var(--color-${metric})`}
								radius={4}
							/>
						</BarChart>
					</ChartContainer>
				) : (
					<Empty className="h-[320px]">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<CircleDollarSignIcon />
							</EmptyMedia>
							<EmptyTitle>Нет сделок с указанной суммой</EmptyTitle>
							<EmptyDescription>
								График появится, когда в сделках будет заполнено поле «Сумма».
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				)}
			</CardContent>
		</Card>
	);
}

const compactMoneyFormatter = new Intl.NumberFormat("ru-RU", {
	notation: "compact",
	maximumFractionDigits: 1,
});

function formatCompactMoney(value: number): string {
	return compactMoneyFormatter.format(value);
}
