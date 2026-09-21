"use client";

import { ExportCsvButton } from "@/components/dashboard/export-csv-button";
import { NotConnected } from "@/components/dashboard/not-connected";
import { PageSuspense } from "@/components/dashboard/page-suspense";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useAttributionReport } from "@/hooks/use-attribution-report";
import { useBitrixData, useDashboardRange } from "@/hooks/use-bitrix-data";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";

export default function AttributionPage() {
	return (
		<PageSuspense>
			<AttributionPageContent />
		</PageSuspense>
	);
}

function RomiBadge({ romi }: { romi: number | null | undefined }) {
	if (romi === null || romi === undefined) return <span>—</span>;
	return (
		<Badge variant={romi >= 0 ? "default" : "destructive"}>
			{romi >= 0 ? "+" : ""}
			{formatPercent(romi)}
		</Badge>
	);
}

function AttributionPageContent() {
	const range = useDashboardRange();
	const { data: bitrixData, isLoading: bitrixLoading } = useBitrixData([]);
	const { data, isLoading, isError } = useAttributionReport(range);

	if (bitrixLoading) {
		return <p className="text-sm text-muted-foreground">Загрузка…</p>;
	}
	if (!bitrixData?.connected) return <NotConnected />;

	if (isLoading) {
		return <p className="text-sm text-muted-foreground">Загрузка…</p>;
	}
	if (isError || !data) {
		return (
			<p className="text-sm text-destructive">
				Не удалось загрузить отчёт атрибуции. Попробуйте обновить страницу.
			</p>
		);
	}

	const { rows, summary } = data;
	const summaryCards = [
		{ label: "Расход на рекламу", value: formatMoney(summary.totalSpend) },
		{ label: "Выручка (выиграно)", value: formatMoney(summary.totalWonSum) },
		{
			label: "ROMI",
			value:
				summary.romi === null
					? "—"
					: `${summary.romi >= 0 ? "+" : ""}${formatPercent(summary.romi)}`,
		},
		{ label: "Сделок", value: formatNumber(summary.totalDeals) },
		{ label: "Выиграно", value: formatNumber(summary.totalWon) },
		{ label: "Конверсия", value: formatPercent(summary.conversionRate) },
	];

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<h1 className="font-heading text-xl font-semibold">Атрибуция</h1>
				<p className="text-sm text-muted-foreground">
					Источник и кампания → сколько сделок и денег принесли, расход на
					рекламу подтягивается автоматически из VK Ads / Яндекс.Директ
				</p>
			</div>

			<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
				{summaryCards.map((card) => (
					<Card key={card.label}>
						<CardHeader>
							<CardDescription>{card.label}</CardDescription>
							<CardTitle className="text-xl tabular-nums">
								{card.value}
							</CardTitle>
						</CardHeader>
					</Card>
				))}
			</div>

			<Card>
				<CardHeader>
					<CardTitle>По источникам и кампаниям</CardTitle>
					<CardDescription>
						Расход сопоставляется с кампанией по числовому ID рекламного
						кабинета в её названии — если сматчить не удалось, показываем «—», а
						не 0.
					</CardDescription>
					<div className="flex justify-end">
						<ExportCsvButton
							filename="attribution.csv"
							headers={[
								"Источник",
								"Кампания",
								"Расход",
								"Сделок",
								"CPL",
								"Выиграно",
								"Выручка",
								"CAC",
								"ROMI, %",
							]}
							rows={rows.map((row) => [
								row.source,
								row.campaign,
								row.spend !== undefined ? Math.round(row.spend) : "",
								row.deals,
								row.cpl !== undefined ? Math.round(row.cpl) : "",
								row.won,
								Math.round(row.wonSum),
								row.cac !== undefined ? Math.round(row.cac) : "",
								row.romi !== undefined ? (row.romi * 100).toFixed(1) : "",
							])}
						/>
					</div>
				</CardHeader>
				<CardContent>
					{rows.length === 0 ? (
						<p className="py-8 text-center text-sm text-muted-foreground">
							Нет сделок за выбранный период
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Источник</TableHead>
									<TableHead>Кампания</TableHead>
									<TableHead className="text-right">Расход</TableHead>
									<TableHead className="text-right">Сделок</TableHead>
									<TableHead className="text-right">CPL</TableHead>
									<TableHead className="text-right">Выиграно</TableHead>
									<TableHead className="text-right">Выручка</TableHead>
									<TableHead className="text-right">CAC</TableHead>
									<TableHead className="text-right">ROMI</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{rows.map((row) => (
									<TableRow key={row.key}>
										<TableCell className="font-medium">{row.source}</TableCell>
										<TableCell>{row.campaign}</TableCell>
										<TableCell className="text-right tabular-nums">
											{row.spend !== undefined ? formatMoney(row.spend) : "—"}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatNumber(row.deals)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{row.cpl !== undefined ? formatMoney(row.cpl) : "—"}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatNumber(row.won)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatMoney(row.wonSum)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{row.cac !== undefined ? formatMoney(row.cac) : "—"}
										</TableCell>
										<TableCell className="text-right">
											<RomiBadge romi={row.romi} />
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
