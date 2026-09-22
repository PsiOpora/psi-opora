"use client";

import { useState } from "react";
import { ExportCsvButton } from "@/components/dashboard/export-csv-button";
import {
	GroupDealsDialog,
	type GroupDealsSelection,
} from "@/components/dashboard/group-deals-dialog";
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
import { UNATTRIBUTED_KEY } from "@/lib/analytics/attribution";
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
	const { data: bitrixData, isLoading: bitrixLoading } = useBitrixData([
		"dealDomain",
	]);
	const { data, isLoading, isError } = useAttributionReport(range);
	const [selection, setSelection] = useState<GroupDealsSelection | null>(null);

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
		{ label: "Новых клиентов", value: formatNumber(summary.totalNewClients) },
		{
			label: "Выручка с новых",
			value: formatMoney(summary.totalNewClientsRevenue),
		},
	];

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<h1 className="font-heading text-xl font-semibold">
					Окупаемость рекламы
				</h1>
				<p className="text-sm text-muted-foreground">
					Источник и кампания → сколько сделок и денег принесли, расход на
					рекламу подтягивается автоматически из Яндекс.Директ
				</p>
			</div>

			<div className="grid grid-cols-2 gap-4 sm:grid-cols-4 xl:grid-cols-8">
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
						кабинета в её названии — если сматчить не удалось для конкретной
						группы, показываем «—», а не 0; расход, который вообще не удалось
						привязать ни к одной кампании (например, ссылку на сайте не обновили
						после пересоздания кампании в кабинете), — отдельной строкой «не
						привязано к UTM-кампании» внизу списка, но он уже учтён в сумме
						сверху. «Новые» — клиенты, для которых сделка в этой группе первая
						за всю историю (выручка — только по ней); «Повторные» — у кого уже
						была более ранняя сделка.
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
								"Новых клиентов",
								"Выручка с новых",
								"Повторных клиентов",
								"Выручка с повторных",
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
								row.newClients,
								row.newClientsRevenue,
								row.repeatClients,
								row.repeatRevenue,
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
									<TableHead className="text-right">Новые клиенты</TableHead>
									<TableHead className="text-right">Повторные</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{rows.map((row) => {
									const isUnattributed = row.key === UNATTRIBUTED_KEY;
									return (
										<TableRow
											key={row.key}
											className={
												isUnattributed ? "text-muted-foreground" : undefined
											}
										>
											<TableCell className="font-medium">
												{isUnattributed ? (
													<span className="italic">{row.source}</span>
												) : (
													row.source
												)}
											</TableCell>
											<TableCell>
												{isUnattributed ? (
													<span className="italic">{row.campaign}</span>
												) : (
													row.campaign
												)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{row.spend !== undefined ? formatMoney(row.spend) : "—"}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{isUnattributed ? (
													formatNumber(row.deals)
												) : (
													<button
														type="button"
														className="hover:underline focus:underline focus:outline-none"
														onClick={() =>
															setSelection({
																dimension: "utmCampaign",
																key: row.key,
																label: `${row.source} / ${row.campaign}`,
																deals: row.deals,
																won: row.won,
																wonSum: row.wonSum,
															})
														}
													>
														{formatNumber(row.deals)}
													</button>
												)}
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
											<TableCell className="text-right tabular-nums">
												<div className="font-medium">
													{formatNumber(row.newClients)}
												</div>
												<div className="text-xs text-muted-foreground">
													{formatMoney(row.newClientsRevenue)}
												</div>
											</TableCell>
											<TableCell className="text-right tabular-nums">
												<div className="font-medium">
													{formatNumber(row.repeatClients)}
												</div>
												<div className="text-xs text-muted-foreground">
													{formatMoney(row.repeatRevenue)}
												</div>
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<GroupDealsDialog
				selection={selection}
				range={range}
				onOpenChange={(open) => !open && setSelection(null)}
				dealDomain={bitrixData?.dealDomain}
			/>
		</div>
	);
}
