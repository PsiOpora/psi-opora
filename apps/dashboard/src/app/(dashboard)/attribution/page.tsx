"use client";

import { useState } from "react";
import { ExportCsvButton } from "@/components/dashboard/export-csv-button";
import {
	GroupDealsDialog,
	type GroupDealsSelection,
} from "@/components/dashboard/group-deals-dialog";
import { InfoHint } from "@/components/dashboard/info-hint";
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
import { UNATTRIBUTED_KEY } from "@/lib/analytics/attribution-constants";
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
		{
			label: "Расход на рекламу",
			hint: "Сумма расходов на рекламу за выбранный период по всем источникам — подтягивается автоматически из Яндекс.Директ.",
			value: formatMoney(summary.totalSpend),
		},
		{
			label: "Выручка (выиграно)",
			hint: "Сумма по сделкам со статусом «Выиграна» за выбранный период.",
			value: formatMoney(summary.totalWonSum),
		},
		{
			label: "ROMI",
			hint: "Return on Marketing Investment — окупаемость вложений в рекламу: (Выручка − Расход) / Расход × 100%. Показывает, сколько прибыли принёс каждый вложенный в рекламу рубль.",
			value:
				summary.romi === null
					? "—"
					: `${summary.romi >= 0 ? "+" : ""}${formatPercent(summary.romi)}`,
		},
		{
			label: "Сделок",
			hint: "Общее количество сделок, созданных за выбранный период.",
			value: formatNumber(summary.totalDeals),
		},
		{
			label: "Выиграно",
			hint: "Количество сделок со статусом «Выиграна» за выбранный период.",
			value: formatNumber(summary.totalWon),
		},
		{
			label: "Проиграно",
			hint: "Количество сделок со статусом «Провалена» за выбранный период.",
			value: formatNumber(summary.totalLost),
		},
		{
			label: "Конверсия",
			hint: "Доля выигранных сделок от общего числа сделок за период: Выиграно / Сделок.",
			value: formatPercent(summary.conversionRate),
		},
		{
			label: "Новых клиентов",
			hint: "Количество клиентов, для которых сделка за этот период — первая за всю историю.",
			value: formatNumber(summary.totalNewClients),
		},
		{
			label: "Выручка с новых",
			hint: "Сумма выигранных сделок только по новым клиентам (для которых это первая сделка).",
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
							<CardDescription className="flex items-center gap-1">
								{card.label}
								<InfoHint text={card.hint} />
							</CardDescription>
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
						Расход/CPL/CAC/ROAS сопоставляются с кампанией по её числовому ID в
						названии или по ручной привязке UTM-кампании в настройках рекламы —
						если сматчить не удалось для конкретной группы, показываем «—», а не
						0; расход, который вообще не удалось привязать ни к одной кампании
						(например, ссылку на сайте не обновили после пересоздания кампании в
						кабинете), — отдельной строкой «не привязано к UTM-кампании» внизу
						списка, но он уже учтён в сумме сверху. «Новые» — клиенты, для
						которых сделка в этой группе первая за всю историю (выручка — только
						по ней); «Повторные» — у кого уже была более ранняя сделка.
					</CardDescription>
					<div className="flex justify-end">
						<ExportCsvButton
							filename="attribution.csv"
							headers={[
								"Источник",
								"Кампания",
								"Кампания в кабинете",
								"Расход",
								"Сделок",
								"CPL",
								"Выиграно",
								"Проиграно",
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
								row.adCampaignName ?? "",
								row.spend !== undefined ? Math.round(row.spend) : "",
								row.deals,
								row.cpl !== undefined ? Math.round(row.cpl) : "",
								row.won,
								row.lost,
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
									<TableHead>
										<div className="flex items-center gap-1">
											Источник
											<InfoHint text="Канал трафика, определённый по UTM-метке utm_source сделки (например, yandex, google, органика)." />
										</div>
									</TableHead>
									<TableHead>
										<div className="flex items-center gap-1">
											Кампания
											<InfoHint text="Название рекламной кампании по UTM-метке utm_campaign. Под ним — название кампании из рекламного кабинета, если удалось сопоставить по числовому ID или ручной привязке." />
										</div>
									</TableHead>
									<TableHead className="text-right">
										<div className="flex items-center justify-end gap-1">
											Расход
											<InfoHint text="Расход на рекламу по этой кампании за период, подтягивается из Яндекс.Директ. «—», если кампанию не удалось сопоставить." />
										</div>
									</TableHead>
									<TableHead className="text-right">
										<div className="flex items-center justify-end gap-1">
											Сделок
											<InfoHint text="Количество сделок с этим источником и кампанией за период. Клик по числу открывает список сделок." />
										</div>
									</TableHead>
									<TableHead className="text-right">
										<div className="flex items-center justify-end gap-1">
											CPL
											<InfoHint text="Cost Per Lead — средняя стоимость одной сделки (лида): Расход / Сделок." />
										</div>
									</TableHead>
									<TableHead className="text-right">
										<div className="flex items-center justify-end gap-1">
											Выиграно
											<InfoHint text="Количество сделок со статусом «Выиграна» из этой группы." />
										</div>
									</TableHead>
									<TableHead className="text-right">
										<div className="flex items-center justify-end gap-1">
											Проиграно
											<InfoHint text="Количество сделок со статусом «Провалена» из этой группы." />
										</div>
									</TableHead>
									<TableHead className="text-right">
										<div className="flex items-center justify-end gap-1">
											Выручка
											<InfoHint text="Сумма выигранных сделок по этой группе." />
										</div>
									</TableHead>
									<TableHead className="text-right">
										<div className="flex items-center justify-end gap-1">
											CAC
											<InfoHint text="Customer Acquisition Cost — средняя стоимость привлечения одного выигранного клиента: Расход / Выиграно." />
										</div>
									</TableHead>
									<TableHead className="text-right">
										<div className="flex items-center justify-end gap-1">
											ROMI
											<InfoHint text="Return on Marketing Investment — окупаемость рекламы по этой группе: (Выручка − Расход) / Расход × 100%." />
										</div>
									</TableHead>
									<TableHead className="text-right">
										<div className="flex items-center justify-end gap-1">
											Новые клиенты
											<InfoHint text="Количество и выручка клиентов, для которых сделка в этой группе — первая за всю историю." />
										</div>
									</TableHead>
									<TableHead className="text-right">
										<div className="flex items-center justify-end gap-1">
											Повторные
											<InfoHint text="Количество и выручка клиентов, у которых уже была более ранняя сделка до этой." />
										</div>
									</TableHead>
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
													<>
														{row.campaign}
														{row.adCampaignName && (
															<div className="text-xs text-muted-foreground">
																{row.adCampaignName}
															</div>
														)}
													</>
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
												{formatNumber(row.lost)}
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
