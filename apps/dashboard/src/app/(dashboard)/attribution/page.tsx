"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import {
	AdSpendDialog,
	type AdSpendSelection,
} from "@/components/dashboard/ad-spend-dialog";
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
import type {
	AdCampaignSpend,
	AttributionRow,
} from "@/lib/analytics/attribution";
import { UNATTRIBUTED_KEY } from "@/lib/analytics/attribution-constants";
import { formatDateParam } from "@/lib/analytics/date-range";
import {
	formatDateRange,
	formatMoney,
	formatNumber,
	formatPercent,
} from "@/lib/format";

export default function AttributionPage() {
	return (
		<PageSuspense>
			<AttributionPageContent />
		</PageSuspense>
	);
}

function formatRomi(romi: number): string {
	return `${romi >= 0 ? "+" : ""}${formatPercent(romi)}`;
}

function RomiBadge({ romi }: { romi: number }) {
	return (
		<Badge variant={romi >= 0 ? "default" : "destructive"}>
			{formatRomi(romi)}
		</Badge>
	);
}

/**
 * Цифра отчёта, по клику раскрывающая, из чего она сложилась (сделки или
 * кампании Директа). Без onClick (нечего показывать, например 0) — обычный текст.
 */
function Drill({
	onClick,
	children,
}: {
	onClick?: () => void;
	children: ReactNode;
}) {
	if (!onClick) return <>{children}</>;
	return (
		<button
			type="button"
			className="cursor-pointer tabular-nums underline decoration-muted-foreground/40 decoration-dotted underline-offset-4 hover:decoration-solid focus:outline-none focus-visible:decoration-solid"
			onClick={onClick}
		>
			{children}
		</button>
	);
}

function rowLabel(row: AttributionRow): string {
	return `${row.source} / ${row.campaign}`;
}

function AttributionPageContent() {
	const range = useDashboardRange();
	const { data: bitrixData, isLoading: bitrixLoading } = useBitrixData([
		"dealDomain",
	]);
	const { data, isLoading, isError } = useAttributionReport(range);
	const [selection, setSelection] = useState<GroupDealsSelection | null>(null);
	const [spendSelection, setSpendSelection] = useState<AdSpendSelection | null>(
		null,
	);

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

	const { rows, summary, spendByCampaign } = data;
	const periodLabel = formatDateRange(range.from, range.to);
	const labelByRowKey = new Map(rows.map((row) => [row.key, rowLabel(row)]));

	const openSpend = (label: string, campaigns: AdCampaignSpend[]) =>
		setSpendSelection({
			label,
			campaigns: campaigns.map((campaign) => ({
				campaignId: campaign.campaignId,
				campaignName: campaign.campaignName,
				spend: campaign.spend,
				rowLabels: campaign.rowKeys.map((key) => labelByRowKey.get(key) ?? key),
			})),
		});

	const spendClick = (row: AttributionRow) => {
		if (row.spend === undefined) return undefined;
		const campaigns =
			row.key === UNATTRIBUTED_KEY
				? spendByCampaign.filter((campaign) => campaign.rowKeys.length === 0)
				: spendByCampaign.filter(
						(campaign) => campaign.campaignId === row.adCampaignId,
					);
		return () => openSpend(rowLabel(row), campaigns);
	};

	/** Клик по цифре строки → сделки этой строки, суженные до нужных. */
	const rowDeals =
		(row: AttributionRow, value: number) =>
		(
			title: string,
			filter: Pick<
				GroupDealsSelection,
				"status" | "clientType" | "description"
			> = {},
		) => {
			if (value <= 0 || row.key === UNATTRIBUTED_KEY) return undefined;
			return () =>
				setSelection({
					dimension: "utmCampaign",
					key: row.key,
					label: `${rowLabel(row)} — ${title}`,
					deals: row.deals,
					won: row.won,
					wonSum: row.wonSum,
					...filter,
				});
		};

	/** Клик по итоговой карточке → сделки всего периода, суженные до нужных. */
	const allDeals =
		(value: number) =>
		(
			title: string,
			filter: Pick<
				GroupDealsSelection,
				"status" | "clientType" | "description"
			> = {},
		) => {
			if (value <= 0) return undefined;
			return () =>
				setSelection({
					label: `Все источники — ${title}`,
					deals: summary.totalDeals,
					won: summary.totalWon,
					wonSum: summary.totalWonSum,
					...filter,
				});
		};

	const summaryCards: {
		label: string;
		hint: string;
		value: string;
		onClick?: () => void;
	}[] = [
		{
			label: "Расход на рекламу",
			hint: "Сумма расходов на рекламу за выбранный период по всем источникам — подтягивается автоматически из Яндекс.Директ. Клик — по каким кампаниям.",
			value: formatMoney(summary.totalSpend),
			onClick:
				spendByCampaign.length > 0
					? () => openSpend("все кампании", spendByCampaign)
					: undefined,
		},
		{
			label: "Выручка (выиграно)",
			hint: "Сумма по сделкам со статусом «Выиграна» за выбранный период. Клик — список этих сделок.",
			value: formatMoney(summary.totalWonSum),
			onClick: allDeals(summary.totalWonSum)("выручка", {
				status: ["won"],
				description: `Выручка = сумма выигранных сделок: ${formatMoney(summary.totalWonSum)}`,
			}),
		},
		{
			label: "ROMI",
			hint: "Return on Marketing Investment — окупаемость вложений в рекламу: (Выручка − Расход) / Расход × 100%. Показывает, сколько прибыли принёс каждый вложенный в рекламу рубль. Клик — расчёт и выигранные сделки.",
			value: summary.romi === null ? "—" : formatRomi(summary.romi),
			onClick:
				summary.romi === null
					? undefined
					: allDeals(summary.totalWon)("ROMI", {
							status: ["won"],
							description: `ROMI = (Выручка − Расход) / Расход = (${formatMoney(summary.totalWonSum)} − ${formatMoney(summary.totalSpend)}) / ${formatMoney(summary.totalSpend)} = ${formatRomi(summary.romi)}. Ниже — выигранные сделки, из которых сложилась выручка.`,
						}),
		},
		{
			label: "Сделок",
			hint: "Общее количество сделок, созданных за выбранный период. Клик — список сделок.",
			value: formatNumber(summary.totalDeals),
			onClick: allDeals(summary.totalDeals)("все сделки"),
		},
		{
			label: "Выиграно",
			hint: "Количество сделок со статусом «Выиграна» за выбранный период. Клик — список сделок.",
			value: formatNumber(summary.totalWon),
			onClick: allDeals(summary.totalWon)("выиграно", { status: ["won"] }),
		},
		{
			label: "Проиграно",
			hint: "Количество сделок со статусом «Провалена» за выбранный период. Клик — список сделок.",
			value: formatNumber(summary.totalLost),
			onClick: allDeals(summary.totalLost)("проиграно", { status: ["lost"] }),
		},
		{
			label: "В работе",
			hint: "Количество сделок, которые ещё не закрыты (не выиграны и не проиграны), за выбранный период. Клик — список сделок.",
			value: formatNumber(summary.totalInProgress),
			onClick: allDeals(summary.totalInProgress)("в работе", {
				status: ["in_progress"],
			}),
		},
		{
			label: "Сумма в работе",
			hint: "Сумма по сделкам, которые ещё не закрыты, за выбранный период. Клик — список сделок.",
			value: formatMoney(summary.totalInProgressSum),
			onClick: allDeals(summary.totalInProgressSum)("в работе", {
				status: ["in_progress"],
				description: `Сумма сделок в работе: ${formatMoney(summary.totalInProgressSum)}`,
			}),
		},
		{
			label: "Конверсия",
			hint: "Доля выигранных сделок от общего числа сделок за период: Выиграно / Сделок. Клик — расчёт и список сделок.",
			value: formatPercent(summary.conversionRate),
			onClick: allDeals(summary.totalDeals)("конверсия", {
				description: `Конверсия = Выиграно / Сделок = ${formatNumber(summary.totalWon)} / ${formatNumber(summary.totalDeals)} = ${formatPercent(summary.conversionRate)}`,
			}),
		},
		{
			label: "Новых клиентов",
			hint: "Количество клиентов, для которых сделка за этот период — первая за всю историю. Клик — их первые сделки.",
			value: formatNumber(summary.totalNewClients),
			onClick: allDeals(summary.totalNewClients)("новые клиенты", {
				clientType: "new",
				description: `Новых клиентов: ${formatNumber(summary.totalNewClients)} — ниже их первые сделки`,
			}),
		},
		{
			label: "Выручка с новых",
			hint: "Сумма выигранных сделок только по новым клиентам (для которых это первая сделка). Клик — список сделок.",
			value: formatMoney(summary.totalNewClientsRevenue),
			onClick: allDeals(summary.totalNewClientsRevenue)("выручка с новых", {
				status: ["won"],
				clientType: "new",
				description: `Выручка с новых клиентов: ${formatMoney(summary.totalNewClientsRevenue)} — выигранные первые сделки`,
			}),
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
					рекламу подтягивается автоматически из Яндекс.Директ. Нажмите на любую
					цифру, чтобы увидеть, из каких сделок или кампаний она сложилась.
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
								<Drill onClick={card.onClick}>{card.value}</Drill>
							</CardTitle>
						</CardHeader>
					</Card>
				))}
			</div>

			<Card>
				<CardHeader>
					<CardTitle>По источникам и кампаниям</CardTitle>
					<p className="text-sm font-medium">Период: {periodLabel}</p>
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
							filename={`okupaemost-reklamy_${formatDateParam(range.from)}_${formatDateParam(range.to)}.csv`}
							headers={[
								"Источник",
								"Кампания",
								"Кампания в кабинете",
								"Расход",
								"Сделок",
								"CPL",
								"Выиграно",
								"Проиграно",
								"В работе",
								"Сумма в работе",
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
								row.inProgress,
								Math.round(row.inProgressSum),
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
											<InfoHint text="Расход на рекламу по этой кампании за период, подтягивается из Яндекс.Директ. «—», если кампанию не удалось сопоставить. Клик — из каких кампаний Директа." />
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
											<InfoHint text="Cost Per Lead — средняя стоимость одной сделки (лида): Расход / Сделок. Клик — расчёт и сделки." />
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
											В работе
											<InfoHint text="Количество и сумма сделок из этой группы, которые ещё не закрыты (не выиграны и не проиграны)." />
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
											<InfoHint text="Customer Acquisition Cost — средняя стоимость привлечения одного выигранного клиента: Расход / Выиграно. Клик — расчёт и выигранные сделки." />
										</div>
									</TableHead>
									<TableHead className="text-right">
										<div className="flex items-center justify-end gap-1">
											ROMI
											<InfoHint text="Return on Marketing Investment — окупаемость рекламы по этой группе: (Выручка − Расход) / Расход × 100%. Клик — расчёт и выигранные сделки." />
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
											<InfoHint text="Количество и выручка клиентов, у которых уже была более ранняя сделка до этой. В списке — их сделки (у одного клиента их может быть несколько)." />
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
												{row.spend !== undefined ? (
													<Drill onClick={spendClick(row)}>
														{formatMoney(row.spend)}
													</Drill>
												) : (
													"—"
												)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												<Drill onClick={rowDeals(row, row.deals)("все сделки")}>
													{formatNumber(row.deals)}
												</Drill>
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{row.cpl !== undefined && row.spend !== undefined ? (
													<Drill
														onClick={rowDeals(row, row.deals)("CPL", {
															description: `CPL = Расход / Сделок = ${formatMoney(row.spend)} / ${formatNumber(row.deals)} = ${formatMoney(row.cpl)}`,
														})}
													>
														{formatMoney(row.cpl)}
													</Drill>
												) : (
													"—"
												)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												<Drill
													onClick={rowDeals(row, row.won)("выиграно", {
														status: ["won"],
													})}
												>
													{formatNumber(row.won)}
												</Drill>
											</TableCell>
											<TableCell className="text-right tabular-nums">
												<Drill
													onClick={rowDeals(row, row.lost)("проиграно", {
														status: ["lost"],
													})}
												>
													{formatNumber(row.lost)}
												</Drill>
											</TableCell>
											<TableCell className="text-right tabular-nums">
												<Drill
													onClick={rowDeals(row, row.inProgress)("в работе", {
														status: ["in_progress"],
														description: `В работе: ${formatNumber(row.inProgress)} сделок на сумму ${formatMoney(row.inProgressSum)}`,
													})}
												>
													<span className="block font-medium">
														{formatNumber(row.inProgress)}
													</span>
													<span className="block text-xs text-muted-foreground">
														{formatMoney(row.inProgressSum)}
													</span>
												</Drill>
											</TableCell>
											<TableCell className="text-right tabular-nums">
												<Drill
													onClick={rowDeals(row, row.wonSum)("выручка", {
														status: ["won"],
														description: `Выручка = сумма выигранных сделок: ${formatMoney(row.wonSum)}`,
													})}
												>
													{formatMoney(row.wonSum)}
												</Drill>
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{row.cac !== undefined && row.spend !== undefined ? (
													<Drill
														onClick={rowDeals(row, row.won)("CAC", {
															status: ["won"],
															description: `CAC = Расход / Выиграно = ${formatMoney(row.spend)} / ${formatNumber(row.won)} = ${formatMoney(row.cac)}`,
														})}
													>
														{formatMoney(row.cac)}
													</Drill>
												) : (
													"—"
												)}
											</TableCell>
											<TableCell className="text-right">
												{row.romi !== undefined && row.spend !== undefined ? (
													<Drill
														onClick={
															rowDeals(row, row.won)("ROMI", {
																status: ["won"],
																description: `ROMI = (Выручка − Расход) / Расход = (${formatMoney(row.wonSum)} − ${formatMoney(row.spend)}) / ${formatMoney(row.spend)} = ${formatRomi(row.romi)}. Ниже — выигранные сделки, из которых сложилась выручка.`,
															}) ?? spendClick(row)
														}
													>
														<RomiBadge romi={row.romi} />
													</Drill>
												) : (
													"—"
												)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												<Drill
													onClick={rowDeals(row, row.newClients)(
														"новые клиенты",
														{
															clientType: "new",
															description: `Новых клиентов: ${formatNumber(row.newClients)}, выручка с них ${formatMoney(row.newClientsRevenue)} — ниже их первые сделки`,
														},
													)}
												>
													<span className="block font-medium">
														{formatNumber(row.newClients)}
													</span>
													<span className="block text-xs text-muted-foreground">
														{formatMoney(row.newClientsRevenue)}
													</span>
												</Drill>
											</TableCell>
											<TableCell className="text-right tabular-nums">
												<Drill
													onClick={rowDeals(row, row.repeatClients)(
														"повторные клиенты",
														{
															clientType: "repeat",
															description: `Повторных клиентов: ${formatNumber(row.repeatClients)}, выручка с них ${formatMoney(row.repeatRevenue)} — ниже их сделки за период (у одного клиента может быть несколько)`,
														},
													)}
												>
													<span className="block font-medium">
														{formatNumber(row.repeatClients)}
													</span>
													<span className="block text-xs text-muted-foreground">
														{formatMoney(row.repeatRevenue)}
													</span>
												</Drill>
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
			<AdSpendDialog
				selection={spendSelection}
				range={range}
				onOpenChange={(open) => !open && setSpendSelection(null)}
			/>
		</div>
	);
}
