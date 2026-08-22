"use client";

import type { DealGroupDimension, DealStatus } from "@psi-opora/db/queries";
import { ArrowUpDownIcon, ChevronDownIcon, RotateCcwIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardAction,
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
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useDashboardRange } from "@/hooks/use-bitrix-data";
import type { DealFacets } from "@/hooks/use-deals-facets";
import { useDealsFacets } from "@/hooks/use-deals-facets";
import {
	type DealsReportFilters,
	type DealsReportSort,
	fetchAllDealsReportRows,
	useDealsReport,
} from "@/hooks/use-deals-report";
import { useDealsSummary } from "@/hooks/use-deals-summary";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { ExportCsvButton } from "./export-csv-button";

const DIMENSIONS: Array<{ id: DealGroupDimension; label: string; time?: boolean }> = [
	{ id: "utmSource", label: "UTM source" },
	{ id: "utmMedium", label: "UTM medium" },
	{ id: "utmCampaign", label: "UTM campaign" },
	{ id: "utmContent", label: "UTM content" },
	{ id: "utmTerm", label: "UTM term" },
	{ id: "source", label: "Источник CRM" },
	{ id: "category", label: "Воронка" },
	{ id: "stage", label: "Стадия" },
	{ id: "day", label: "По дням", time: true },
	{ id: "week", label: "По неделям", time: true },
	{ id: "month", label: "По месяцам", time: true },
];

type MetricId = "deals" | "won" | "wonSum" | "opportunitySum" | "conversionRate";

const METRICS: Array<{ id: MetricId; label: string }> = [
	{ id: "deals", label: "Сделки" },
	{ id: "won", label: "Выиграно" },
	{ id: "wonSum", label: "Сумма выигранных" },
	{ id: "opportunitySum", label: "Сумма в воронке" },
	{ id: "conversionRate", label: "Конверсия, %" },
];

interface MetricRow {
	deals: number;
	won: number;
	wonSum: number;
	opportunitySum: number;
	conversionRate: number;
}

function metricValue(row: MetricRow, metric: MetricId): number {
	if (metric === "conversionRate")
		return Number((row.conversionRate * 100).toFixed(1));
	return row[metric];
}

type FilterId =
	| "status"
	| "category"
	| "source"
	| "utmSource"
	| "utmMedium"
	| "utmCampaign";

const FILTERS: Array<{ id: FilterId; label: string }> = [
	{ id: "status", label: "Статус" },
	{ id: "category", label: "Воронка" },
	{ id: "source", label: "Источник CRM" },
	{ id: "utmSource", label: "UTM source" },
	{ id: "utmMedium", label: "UTM medium" },
	{ id: "utmCampaign", label: "UTM campaign" },
];

const FACET_KEY: Record<FilterId, keyof DealFacets> = {
	status: "status",
	category: "categoryId",
	source: "sourceId",
	utmSource: "utmSource",
	utmMedium: "utmMedium",
	utmCampaign: "utmCampaign",
};

type SortKey = "label" | "deals" | "won" | "conversionRate" | "wonSum" | "opportunitySum";

const EMPTY_FILTERS: Record<FilterId, string[]> = {
	status: [],
	category: [],
	source: [],
	utmSource: [],
	utmMedium: [],
	utmCampaign: [],
};

const CHART_TOP_LIMIT = 12;
const TABLE_PAGE_SIZE = 20;
// Сервер клампит pageSize до 100 (apps/dashboard/.../deals/report/route.ts) —
// для дневного/недельного/месячного разреза это разумный потолок точек графика.
const CHART_TIME_PAGE_SIZE = 100;

/**
 * Конструктор отчёта: группировка/метрика/фильтры/сортировка живут в URL и
 * состоянии, сами данные (агрегация, фильтр-фасеты, сводка) — на сервере
 * (packages/db/src/queries/deals.ts), а не проход по всем сделкам периода в
 * браузере, как раньше (lib/analytics/aggregate.ts).
 */
export function ReportBuilder() {
	const range = useDashboardRange();
	const searchParams = useSearchParams();
	const [dimension, setDimension] = useState<DealGroupDimension>(() => {
		const value = searchParams.get("g");
		return DIMENSIONS.some((d) => d.id === value)
			? (value as DealGroupDimension)
			: "utmSource";
	});
	const [metric, setMetric] = useState<MetricId>(() => {
		const value = searchParams.get("m");
		return METRICS.some((m) => m.id === value) ? (value as MetricId) : "deals";
	});
	const [chartKind, setChartKind] = useState<"bar" | "line">(() =>
		searchParams.get("ch") === "line" ? "line" : "bar",
	);
	const [filters, setFilters] = useState<Record<FilterId, string[]>>(() => {
		const initial = { ...EMPTY_FILTERS };
		for (const filter of FILTERS)
			initial[filter.id] = searchParams.getAll(`f_${filter.id}`);
		return initial;
	});
	const [sort, setSort] = useState<{ key: SortKey; desc: boolean } | null>(
		null,
	);
	const [pageIndex, setPageIndex] = useState(0);

	// Reset pagination when range changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: range is intentionally used only to trigger the reset, not read inside the effect
	useEffect(() => {
		setPageIndex(0);
	}, [range]);

	useEffect(() => {
		// history.replaceState вместо router.replace — без перезапроса серверной страницы
		const params = new URLSearchParams(window.location.search);
		params.delete("g");
		params.delete("m");
		params.delete("ch");
		for (const filter of FILTERS) params.delete(`f_${filter.id}`);
		if (dimension !== "utmSource") params.set("g", dimension);
		if (metric !== "deals") params.set("m", metric);
		if (chartKind !== "bar") params.set("ch", chartKind);
		for (const filter of FILTERS) {
			for (const value of filters[filter.id])
				params.append(`f_${filter.id}`, value);
		}
		const query = params.toString();
		window.history.replaceState(
			null,
			"",
			query ? `?${query}` : window.location.pathname,
		);
	}, [dimension, metric, chartKind, filters]);

	const isTime = DIMENSIONS.find((d) => d.id === dimension)?.time ?? false;
	const metricInfo =
		METRICS.find((m) => m.id === metric) ??
		(METRICS[0] as (typeof METRICS)[number]);
	const dimensionInfo =
		DIMENSIONS.find((d) => d.id === dimension) ??
		(DIMENSIONS[0] as (typeof DIMENSIONS)[number]);

	const reportFilters: DealsReportFilters = {
		status: filters.status.length > 0 ? (filters.status as DealStatus[]) : undefined,
		categoryId: filters.category.length > 0 ? filters.category : undefined,
		sourceId: filters.source.length > 0 ? filters.source : undefined,
		utmSource: filters.utmSource.length > 0 ? filters.utmSource : undefined,
		utmMedium: filters.utmMedium.length > 0 ? filters.utmMedium : undefined,
		utmCampaign: filters.utmCampaign.length > 0 ? filters.utmCampaign : undefined,
	};

	const facets = useDealsFacets(range);
	const summaryQuery = useDealsSummary({ range, filters: reportFilters });

	const sortField: DealsReportSort = sort
		? sort.key === "label"
			? "key"
			: sort.key
		: isTime
			? "key"
			: "deals";
	const sortDir: "asc" | "desc" = sort
		? sort.desc
			? "desc"
			: "asc"
		: isTime
			? "asc"
			: "desc";

	const table = useDealsReport({
		dimension,
		range,
		...reportFilters,
		page: pageIndex + 1,
		pageSize: TABLE_PAGE_SIZE,
		sort: sortField,
		sortDir,
	});
	const chart = useDealsReport({
		dimension,
		range,
		...reportFilters,
		page: 1,
		pageSize: isTime ? CHART_TIME_PAGE_SIZE : CHART_TOP_LIMIT,
		sort: isTime ? "key" : metric,
		sortDir: isTime ? "asc" : "desc",
	});

	const tableRows = table.data?.rows ?? [];
	const groupsTotal = table.data?.total ?? 0;
	const pageCount = Math.max(1, Math.ceil(groupsTotal / TABLE_PAGE_SIZE));
	const summary = summaryQuery.data?.summary;

	const chartRows = (chart.data?.rows ?? []).map((row) => ({
		label: row.label,
		value: metricValue(row, metric),
	}));

	const chartConfig = {
		value: { label: metricInfo.label, color: "var(--chart-1)" },
	} satisfies ChartConfig;
	const activeFilterCount = FILTERS.reduce(
		(sum, f) => sum + (filters[f.id].length > 0 ? 1 : 0),
		0,
	);

	function toggleFilter(id: FilterId, value: string, checked: boolean) {
		setFilters((prev) => ({
			...prev,
			[id]: checked
				? [...prev[id], value]
				: prev[id].filter((v) => v !== value),
		}));
		setPageIndex(0);
	}

	function toggleSort(key: SortKey) {
		setSort((prev) =>
			prev?.key === key
				? { key, desc: !prev.desc }
				: { key, desc: key !== "label" },
		);
		setPageIndex(0);
	}

	function SortHead({
		label,
		sortKey,
		numeric,
	}: {
		label: string;
		sortKey: SortKey;
		numeric?: boolean;
	}) {
		return (
			<TableHead className={numeric ? "text-right" : undefined}>
				<Button variant="ghost" size="sm" onClick={() => toggleSort(sortKey)}>
					{label}
					<ArrowUpDownIcon data-icon="inline-end" />
				</Button>
			</TableHead>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<Card>
				<CardHeader>
					<CardTitle>Конструктор отчёта</CardTitle>
					<CardDescription>
						Выберите группировку, метрику и фильтры — таблица и график обновятся
						сразу. Период задаётся в шапке.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<div className="flex flex-wrap items-end gap-3">
						<div className="flex flex-col gap-1">
							<Label className="text-xs text-muted-foreground">
								Группировка
							</Label>
							<Select
								value={dimension}
								onValueChange={(v) => {
									setDimension(v as DealGroupDimension);
									setPageIndex(0);
								}}
							>
								<SelectTrigger className="w-44">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{DIMENSIONS.map((d) => (
										<SelectItem key={d.id} value={d.id}>
											{d.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="flex flex-col gap-1">
							<Label className="text-xs text-muted-foreground">
								Метрика графика
							</Label>
							<Select
								value={metric}
								onValueChange={(v) => setMetric(v as MetricId)}
							>
								<SelectTrigger className="w-48">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{METRICS.map((m) => (
										<SelectItem key={m.id} value={m.id}>
											{m.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="flex flex-col gap-1">
							<Label className="text-xs text-muted-foreground">
								Вид графика
							</Label>
							<Select
								value={chartKind}
								onValueChange={(v) => setChartKind(v as "bar" | "line")}
							>
								<SelectTrigger className="w-36">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="bar">Столбцы</SelectItem>
									<SelectItem value="line">Линия</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						{FILTERS.map((filter) => {
							const selected = filters[filter.id];
							const options = facets.data?.[FACET_KEY[filter.id]] ?? [];
							return (
								<DropdownMenu key={filter.id}>
									<DropdownMenuTrigger asChild>
										<Button variant="outline" size="sm">
											{filter.label}
											{selected.length > 0 && (
												<Badge variant="secondary">{selected.length}</Badge>
											)}
											<ChevronDownIcon data-icon="inline-end" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent
										align="start"
										className="max-h-72 overflow-y-auto"
									>
										{options.map((option) => (
											<DropdownMenuCheckboxItem
												key={option.value}
												checked={selected.includes(option.value)}
												onCheckedChange={(checked) =>
													toggleFilter(
														filter.id,
														option.value,
														checked === true,
													)
												}
												onSelect={(event) => event.preventDefault()}
											>
												{option.label}
												<span className="ml-1 text-muted-foreground">
													({formatNumber(option.count)})
												</span>
											</DropdownMenuCheckboxItem>
										))}
									</DropdownMenuContent>
								</DropdownMenu>
							);
						})}
						{activeFilterCount > 0 && (
							<Button
								variant="ghost"
								size="sm"
								onClick={() => {
									setFilters(EMPTY_FILTERS);
									setPageIndex(0);
								}}
							>
								<RotateCcwIcon data-icon="inline-start" />
								Сбросить
							</Button>
						)}
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>
						{dimensionInfo.label}: {metricInfo.label}
					</CardTitle>
					<CardDescription>
						{summary &&
							`${formatNumber(summary.totalDeals)} сделок · выиграно ${formatNumber(summary.wonDeals)} · конверсия ${formatPercent(summary.conversionRate)} · сумма выигранных ${formatMoney(summary.wonSum)}`}
						{!isTime &&
							groupsTotal > CHART_TOP_LIMIT &&
							` · на графике топ-${CHART_TOP_LIMIT} групп`}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{chartRows.length === 0 ? (
						<p className="py-8 text-center text-sm text-muted-foreground">
							Нет данных под выбранные фильтры
						</p>
					) : (
						<ChartContainer config={chartConfig} className="h-[320px] w-full">
							{chartKind === "line" ? (
								<LineChart data={chartRows}>
									<CartesianGrid vertical={false} />
									<XAxis
										dataKey="label"
										tickLine={false}
										axisLine={false}
										tickMargin={8}
									/>
									<YAxis tickLine={false} axisLine={false} width={48} />
									<ChartTooltip content={<ChartTooltipContent />} />
									<Line
										dataKey="value"
										type="monotone"
										stroke="var(--color-value)"
										strokeWidth={2}
										dot={false}
									/>
								</LineChart>
							) : isTime ? (
								<BarChart data={chartRows}>
									<CartesianGrid vertical={false} />
									<XAxis
										dataKey="label"
										tickLine={false}
										axisLine={false}
										tickMargin={8}
									/>
									<YAxis tickLine={false} axisLine={false} width={48} />
									<ChartTooltip content={<ChartTooltipContent />} />
									<Bar dataKey="value" fill="var(--color-value)" radius={4} />
								</BarChart>
							) : (
								<BarChart
									data={chartRows}
									layout="vertical"
									margin={{ left: 16 }}
								>
									<CartesianGrid horizontal={false} />
									<XAxis type="number" tickLine={false} axisLine={false} />
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
									<Bar dataKey="value" fill="var(--color-value)" radius={4} />
								</BarChart>
							)}
						</ChartContainer>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Таблица: {dimensionInfo.label}</CardTitle>
					<CardDescription>
						{formatNumber(groupsTotal)} групп — сортировка по клику на
						заголовок столбца
					</CardDescription>
					<CardAction>
						<ExportCsvButton
							filename={`report-${dimension}.csv`}
							headers={[
								dimensionInfo.label,
								"Сделок",
								"Выиграно",
								"Конверсия, %",
								"Сумма выигранных",
								"Сумма в воронке",
							]}
							getRows={async () => {
								const rows = await fetchAllDealsReportRows(
									dimension,
									range,
									reportFilters,
								);
								return rows.map((row) => [
									row.label,
									row.deals,
									row.won,
									(row.conversionRate * 100).toFixed(1),
									Math.round(row.wonSum),
									Math.round(row.opportunitySum),
								]);
							}}
						/>
					</CardAction>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<SortHead label={dimensionInfo.label} sortKey="label" />
								<SortHead label="Сделок" sortKey="deals" numeric />
								<SortHead label="Выиграно" sortKey="won" numeric />
								<SortHead label="Конверсия" sortKey="conversionRate" numeric />
								<SortHead label="Сумма выигранных" sortKey="wonSum" numeric />
								<SortHead
									label="Сумма в воронке"
									sortKey="opportunitySum"
									numeric
								/>
							</TableRow>
						</TableHeader>
						<TableBody>
							{table.isLoading ? (
								<TableRow>
									<TableCell
										colSpan={6}
										className="py-8 text-center text-muted-foreground"
									>
										Загрузка…
									</TableCell>
								</TableRow>
							) : table.isError ? (
								<TableRow>
									<TableCell
										colSpan={6}
										className="py-8 text-center text-destructive"
									>
										Не удалось загрузить данные таблицы. Попробуйте обновить
										страницу.
									</TableCell>
								</TableRow>
							) : tableRows.length === 0 ? (
								<TableRow>
									<TableCell
										colSpan={6}
										className="py-8 text-center text-muted-foreground"
									>
										Нет данных под выбранные фильтры
									</TableCell>
								</TableRow>
							) : (
								tableRows.map((row) => (
									<TableRow key={row.key}>
										<TableCell className="font-medium">{row.label}</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatNumber(row.deals)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatNumber(row.won)}
										</TableCell>
										<TableCell className="text-right">
											<Badge variant="secondary">
												{formatPercent(row.conversionRate)}
											</Badge>
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatMoney(row.wonSum)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatMoney(row.opportunitySum)}
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>

					{groupsTotal > TABLE_PAGE_SIZE && (
						<div className="flex items-center justify-between gap-4 pt-3 text-sm text-muted-foreground">
							<span>
								{formatNumber(pageIndex * TABLE_PAGE_SIZE + 1)}–
								{formatNumber(
									Math.min(groupsTotal, (pageIndex + 1) * TABLE_PAGE_SIZE),
								)}{" "}
								из {formatNumber(groupsTotal)}
							</span>
							<div className="flex items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
									disabled={pageIndex === 0}
								>
									Назад
								</Button>
								<span className="tabular-nums">
									{pageIndex + 1} / {pageCount}
								</span>
								<Button
									variant="outline"
									size="sm"
									onClick={() =>
										setPageIndex((i) => Math.min(pageCount - 1, i + 1))
									}
									disabled={pageIndex >= pageCount - 1}
								>
									Вперёд
								</Button>
							</div>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
