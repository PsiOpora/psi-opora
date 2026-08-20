import { TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type { Summary } from "@/lib/analytics/types";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

function deltaOf(current: number, previous: number): number | null {
	if (previous <= 0) return null;
	return (current - previous) / previous;
}

function DeltaBadge({ delta }: { delta: number | null }) {
	if (delta === null) return null;
	const positive = delta >= 0;
	const Icon = positive ? TrendingUpIcon : TrendingDownIcon;
	return (
		<Badge
			variant="outline"
			className={cn(positive ? "text-emerald-600" : "text-red-600")}
		>
			<Icon data-icon="inline-start" />
			{positive ? "+" : ""}
			{formatPercent(delta)}
		</Badge>
	);
}

export function KpiCards({
	summary,
	previous,
}: {
	summary: Summary;
	previous?: Summary;
}) {
	const items = [
		{
			label: "Всего сделок",
			value: formatNumber(summary.totalDeals),
			hint: `${formatNumber(summary.inProgressDeals)} в работе`,
			delta: previous ? deltaOf(summary.totalDeals, previous.totalDeals) : null,
		},
		{
			label: "Выиграно сделок",
			value: formatNumber(summary.wonDeals),
			hint:
				`Конверсия ${formatPercent(summary.conversionRate)}` +
				(summary.avgCycleDays > 0
					? ` · цикл ${Math.round(summary.avgCycleDays)} дн.`
					: ""),
			delta: previous ? deltaOf(summary.wonDeals, previous.wonDeals) : null,
		},
		{
			label: "Сумма выигранных",
			value: formatMoney(summary.wonSum),
			hint: `Средний чек ${formatMoney(summary.avgDealSize)}`,
			delta: previous ? deltaOf(summary.wonSum, previous.wonSum) : null,
		},
		{
			label: "Сумма в воронке",
			value: formatMoney(summary.opportunitySum),
			hint: `${formatNumber(summary.lostDeals)} проиграно`,
			delta: previous
				? deltaOf(summary.opportunitySum, previous.opportunitySum)
				: null,
		},
	];

	return (
		<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
			{items.map((item) => (
				<Card key={item.label}>
					<CardHeader>
						<CardDescription>{item.label}</CardDescription>
						<CardTitle className="text-2xl tabular-nums">
							{item.value}
						</CardTitle>
						<CardAction>
							<DeltaBadge delta={item.delta} />
						</CardAction>
					</CardHeader>
					<CardContent className="text-xs text-muted-foreground">
						{item.hint}
					</CardContent>
				</Card>
			))}
		</div>
	);
}
