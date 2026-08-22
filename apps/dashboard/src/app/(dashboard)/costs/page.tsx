"use client";

import type { CostEntry } from "@psi-opora/api";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ExportCsvButton } from "@/components/dashboard/export-csv-button";
import type { GroupStatsRow } from "@/components/dashboard/group-stats-table";
import { NotConnected } from "@/components/dashboard/not-connected";
import { PageSuspense } from "@/components/dashboard/page-suspense";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardAction,
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
import { useBitrixData, useDashboardRange } from "@/hooks/use-bitrix-data";
import { fetchAllDealsReportRows } from "@/hooks/use-deals-report";
import { formatDateParam } from "@/lib/analytics/date-range";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { monthIntersectsRange } from "@/lib/marketing/costs";
import { orpc } from "@/lib/orpc/client";
import { UTM_CAMPAIGN_KEY_SEPARATOR } from "@/lib/constants/separators";
import { AddCostForm } from "./add-cost-form";
import { DeleteCostButton } from "./delete-cost-button";

interface RoiRow {
	key: string;
	utmSource: string;
	utmCampaign: string;
	spend: number;
	deals: number;
	cpl: number | null;
	won: number;
	revenue: number;
	romi: number | null;
}

function matchesEntry(
	row: GroupStatsRow,
	utmSource: string,
	utmCampaign: string,
): boolean {
	const [rowSource, rowCampaign] = row.key.split(UTM_CAMPAIGN_KEY_SEPARATOR);
	if (rowSource !== utmSource) return false;
	return utmCampaign === "" || rowCampaign === utmCampaign;
}

/**
 * Сопоставление расходов со сделками по utm_source(+utm_campaign) — join по
 * уже агрегированным на сервере группам (groupDealsBy("utmCampaign", ...),
 * см. use-deals-report.ts), а не построчный проход по всем сделкам периода в JS.
 */
function buildRoiRows(
	costs: CostEntry[],
	utmCampaignRows: GroupStatsRow[],
	from: Date,
	to: Date,
): RoiRow[] {
	const inRange = costs.filter((c) => monthIntersectsRange(c.month, from, to));
	const spendByKey = new Map<
		string,
		{ utmSource: string; utmCampaign: string; spend: number }
	>();
	for (const cost of inRange) {
		const key = `${cost.utmSource}|${cost.utmCampaign}`;
		const row = spendByKey.get(key) ?? {
			utmSource: cost.utmSource,
			utmCampaign: cost.utmCampaign,
			spend: 0,
		};
		row.spend += cost.amount;
		spendByKey.set(key, row);
	}

	return [...spendByKey.values()]
		.map(({ utmSource, utmCampaign, spend }) => {
			const matched = utmCampaignRows.filter((row) =>
				matchesEntry(row, utmSource, utmCampaign),
			);
			const deals = matched.reduce((sum, row) => sum + row.deals, 0);
			const won = matched.reduce((sum, row) => sum + row.won, 0);
			const revenue = matched.reduce((sum, row) => sum + row.wonSum, 0);
			return {
				key: `${utmSource}|${utmCampaign}`,
				utmSource,
				utmCampaign,
				spend,
				deals,
				cpl: deals > 0 ? spend / deals : null,
				won,
				revenue,
				romi: spend > 0 ? (revenue - spend) / spend : null,
			};
		})
		.sort((a, b) => b.spend - a.spend);
}

export default function CostsPage() {
	return (
		<PageSuspense>
			<CostsPageContent />
		</PageSuspense>
	);
}

function CostsPageContent() {
	const range = useDashboardRange();
	const { data: bitrixData, isLoading: bitrixLoading } = useBitrixData([]);
	const { data: redisStatus } = useQuery({
		queryKey: ["dashboard-redis-status"],
		queryFn: async () => {
			const res = await fetch("/api/dashboard/redis-status");
			if (!res.ok) throw new Error("Не удалось проверить Redis");
			return (await res.json()) as { configured: boolean };
		},
	});
	const { data: costs = [], isLoading: costsLoading } = useQuery(
		orpc.costs.list.queryOptions(),
	);
	const {
		data: utmCampaignRows = [],
		isLoading: utmLoading,
		isError: utmError,
	} = useQuery({
		queryKey: [
			"dashboard-costs-utm-campaign-rows",
			formatDateParam(range.from),
			formatDateParam(range.to),
		],
		queryFn: () => fetchAllDealsReportRows("utmCampaign", range),
	});

	const roiRows = useMemo(
		() => buildRoiRows(costs, utmCampaignRows, range.from, range.to),
		[costs, utmCampaignRows, range.from, range.to],
	);

	if (bitrixLoading) {
		return <p className="text-sm text-muted-foreground">Загрузка…</p>;
	}
	if (!bitrixData?.connected) return <NotConnected />;

	if (redisStatus && !redisStatus.configured) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Расходы</CardTitle>
					<CardDescription>
						Хранилище расходов недоступно: REDIS_URL или REDIS_HOST не задан. В
						k3s адрес задаётся автоматически; локально укажите REDIS_URL.
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	if (costsLoading || utmLoading) {
		return <p className="text-sm text-muted-foreground">Загрузка…</p>;
	}

	if (utmError) {
		return (
			<p className="text-sm text-destructive">
				Не удалось загрузить данные UTM. Попробуйте обновить страницу.
			</p>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<Card>
				<CardHeader>
					<CardTitle>Эффективность каналов</CardTitle>
					<CardDescription>
						Расходы сопоставляются со сделками по utm_source (+ utm_campaign,
						если указана). Расход учитывается за целые месяцы, пересекающиеся с
						выбранным периодом.
					</CardDescription>
					<CardAction>
						<ExportCsvButton
							filename="channel-roi.csv"
							headers={[
								"Источник",
								"Кампания",
								"Расход",
								"Сделок",
								"CPL",
								"Выиграно",
								"Выручка",
								"ROMI, %",
							]}
							rows={roiRows.map((row) => [
								row.utmSource,
								row.utmCampaign,
								Math.round(row.spend),
								row.deals,
								row.cpl !== null ? Math.round(row.cpl) : "",
								row.won,
								Math.round(row.revenue),
								row.romi !== null ? (row.romi * 100).toFixed(1) : "",
							])}
						/>
					</CardAction>
				</CardHeader>
				<CardContent>
					{roiRows.length === 0 ? (
						<p className="py-8 text-center text-sm text-muted-foreground">
							Добавьте расходы ниже, чтобы увидеть CPL и ROMI по каналам
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
									<TableHead className="text-right">ROMI</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{roiRows.map((row) => (
									<TableRow key={row.key}>
										<TableCell className="font-medium">
											{row.utmSource}
										</TableCell>
										<TableCell>{row.utmCampaign || "(все кампании)"}</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatMoney(row.spend)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatNumber(row.deals)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{row.cpl !== null ? formatMoney(row.cpl) : "—"}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatNumber(row.won)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatMoney(row.revenue)}
										</TableCell>
										<TableCell className="text-right">
											{row.romi !== null ? (
												<Badge
													variant={row.romi >= 0 ? "default" : "destructive"}
												>
													{row.romi >= 0 ? "+" : ""}
													{formatPercent(row.romi)}
												</Badge>
											) : (
												"—"
											)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Добавить расход</CardTitle>
					<CardDescription>
						Суммы из рекламных кабинетов (Яндекс.Директ, VK Ads, Telegram Ads)
						вносятся вручную помесячно
					</CardDescription>
				</CardHeader>
				<CardContent>
					<AddCostForm />
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Внесённые расходы</CardTitle>
					<CardDescription>
						{formatNumber(costs.length)} записей за всё время
					</CardDescription>
				</CardHeader>
				<CardContent>
					{costs.length === 0 ? (
						<p className="py-8 text-center text-sm text-muted-foreground">
							Расходов пока нет
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Месяц</TableHead>
									<TableHead>UTM source</TableHead>
									<TableHead>UTM campaign</TableHead>
									<TableHead className="text-right">Сумма</TableHead>
									<TableHead>Заметка</TableHead>
									<TableHead className="w-12" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{costs.map((cost) => (
									<TableRow key={cost.id}>
										<TableCell className="font-medium tabular-nums">
											{cost.month}
										</TableCell>
										<TableCell>{cost.utmSource}</TableCell>
										<TableCell>
											{cost.utmCampaign || "(все кампании)"}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatMoney(cost.amount)}
										</TableCell>
										<TableCell className="text-muted-foreground">
											{cost.note}
										</TableCell>
										<TableCell>
											<DeleteCostButton
												id={cost.id}
												label={`${cost.month} · ${cost.utmSource} · ${formatMoney(cost.amount)}`}
											/>
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
