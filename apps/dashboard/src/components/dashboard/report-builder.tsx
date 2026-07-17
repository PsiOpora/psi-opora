"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowUpDownIcon, ChevronDownIcon, RotateCcwIcon } from "lucide-react";
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
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
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
import {
  bucketBy,
  computeGroupStats,
  summarize,
} from "@/lib/analytics/aggregate";
import type { DealRecord, DealStatus, GroupStats } from "@/lib/analytics/types";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { ExportCsvButton } from "./export-csv-button";

export interface ReportDictionaries {
  sources: Record<string, string>;
  categories: Record<string, string>;
  stages: Record<string, string>;
}

const STATUS_LABELS: Record<DealStatus, string> = {
  won: "Выиграна",
  lost: "Проиграна",
  in_progress: "В работе",
};

function localDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function weekStart(date: Date): string {
  const monday = new Date(date);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return localDate(monday);
}

type DimensionId =
  | "utmSource"
  | "utmMedium"
  | "utmCampaign"
  | "utmContent"
  | "utmTerm"
  | "source"
  | "category"
  | "stage"
  | "day"
  | "week"
  | "month";

const DIMENSIONS: Array<{ id: DimensionId; label: string; time?: boolean }> = [
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

function dimensionKey(deal: DealRecord, dimension: DimensionId): string {
  switch (dimension) {
    case "utmSource":
      return deal.utmSource;
    case "utmMedium":
      return deal.utmMedium;
    case "utmCampaign":
      return deal.utmCampaign;
    case "utmContent":
      return deal.utmContent;
    case "utmTerm":
      return deal.utmTerm;
    case "source":
      return deal.sourceId;
    case "category":
      return deal.categoryId;
    case "stage":
      return deal.stageId;
    case "day":
      return localDate(deal.dateCreate);
    case "week":
      return weekStart(deal.dateCreate);
    case "month":
      return localDate(deal.dateCreate).slice(0, 7);
  }
}

function dimensionLabel(
  key: string,
  dimension: DimensionId,
  dicts: ReportDictionaries,
): string {
  if (dimension === "source") return dicts.sources[key] ?? key;
  if (dimension === "category")
    return dicts.categories[key] ?? `Воронка ${key}`;
  if (dimension === "stage") return dicts.stages[key] ?? key;
  return key;
}

type MetricId =
  | "deals"
  | "won"
  | "wonSum"
  | "opportunitySum"
  | "conversionRate";

const METRICS: Array<{
  id: MetricId;
  label: string;
  money?: boolean;
  percent?: boolean;
}> = [
  { id: "deals", label: "Сделки" },
  { id: "won", label: "Выиграно" },
  { id: "wonSum", label: "Сумма выигранных", money: true },
  { id: "opportunitySum", label: "Сумма в воронке", money: true },
  { id: "conversionRate", label: "Конверсия, %", percent: true },
];

function metricValue(row: GroupStats, metric: MetricId): number {
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

const FILTERS: Array<{
  id: FilterId;
  label: string;
  valueOf: (deal: DealRecord) => string;
}> = [
  { id: "status", label: "Статус", valueOf: (d) => d.status },
  { id: "category", label: "Воронка", valueOf: (d) => d.categoryId },
  { id: "source", label: "Источник CRM", valueOf: (d) => d.sourceId },
  { id: "utmSource", label: "UTM source", valueOf: (d) => d.utmSource },
  { id: "utmMedium", label: "UTM medium", valueOf: (d) => d.utmMedium },
  { id: "utmCampaign", label: "UTM campaign", valueOf: (d) => d.utmCampaign },
];

function filterValueLabel(
  filter: FilterId,
  value: string,
  dicts: ReportDictionaries,
): string {
  if (filter === "status") return STATUS_LABELS[value as DealStatus] ?? value;
  if (filter === "category")
    return dicts.categories[value] ?? `Воронка ${value}`;
  if (filter === "source") return dicts.sources[value] ?? value;
  return value;
}

type SortKey =
  | "label"
  | "deals"
  | "won"
  | "conversionRate"
  | "wonSum"
  | "opportunitySum";

const EMPTY_FILTERS: Record<FilterId, string[]> = {
  status: [],
  category: [],
  source: [],
  utmSource: [],
  utmMedium: [],
  utmCampaign: [],
};

const CHART_TOP_LIMIT = 12;

export function ReportBuilder({
  deals,
  dictionaries,
}: {
  deals: DealRecord[];
  dictionaries: ReportDictionaries;
}) {
  // Настройки отчёта живут в URL (?g=, ?m=, ?ch=, ?f_*) — ссылкой можно поделиться
  const searchParams = useSearchParams();
  const [dimension, setDimension] = useState<DimensionId>(() => {
    const value = searchParams.get("g");
    return DIMENSIONS.some((d) => d.id === value)
      ? (value as DimensionId)
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

  // Варианты значений для каждого фильтра — по всем сделкам периода, с количеством
  const filterOptions = useMemo(() => {
    const options = new Map<
      FilterId,
      Array<{ value: string; label: string; count: number }>
    >();
    for (const filter of FILTERS) {
      const counts = new Map<string, number>();
      for (const deal of deals) {
        const value = filter.valueOf(deal);
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      options.set(
        filter.id,
        [...counts.entries()]
          .map(([value, count]) => ({
            value,
            label: filterValueLabel(filter.id, value, dictionaries),
            count,
          }))
          .sort((a, b) => b.count - a.count),
      );
    }
    return options;
  }, [deals, dictionaries]);

  const filtered = useMemo(
    () =>
      deals.filter((deal) =>
        FILTERS.every((filter) => {
          const selected = filters[filter.id];
          return (
            selected.length === 0 || selected.includes(filter.valueOf(deal))
          );
        }),
      ),
    [deals, filters],
  );

  const summary = useMemo(() => summarize(filtered), [filtered]);

  const groups = useMemo(
    () =>
      computeGroupStats(
        bucketBy(filtered, (deal) => dimensionKey(deal, dimension)),
        (key) => dimensionLabel(key, dimension, dictionaries),
      ),
    [filtered, dimension, dictionaries],
  );

  const tableRows = useMemo(() => {
    const key = sort?.key ?? (isTime ? "label" : "deals");
    const desc = sort ? sort.desc : !isTime;
    return [...groups].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      const cmp =
        typeof av === "string"
          ? av.localeCompare(bv as string, "ru")
          : av - (bv as number);
      return desc ? -cmp : cmp;
    });
  }, [groups, sort, isTime]);

  const chartRows = useMemo(() => {
    const rows = isTime
      ? [...groups].sort((a, b) => a.key.localeCompare(b.key))
      : [...groups]
          .sort((a, b) => metricValue(b, metric) - metricValue(a, metric))
          .slice(0, CHART_TOP_LIMIT);
    return rows.map((row) => ({
      label: row.label,
      value: metricValue(row, metric),
    }));
  }, [groups, isTime, metric]);

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
  }

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev?.key === key
        ? { key, desc: !prev.desc }
        : { key, desc: key !== "label" },
    );
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
                onValueChange={(v) => setDimension(v as DimensionId)}
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
                    {(filterOptions.get(filter.id) ?? []).map((option) => (
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
                onClick={() => setFilters(EMPTY_FILTERS)}
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
            {formatNumber(summary.totalDeals)} сделок · выиграно{" "}
            {formatNumber(summary.wonDeals)} · конверсия{" "}
            {formatPercent(summary.conversionRate)} · сумма выигранных{" "}
            {formatMoney(summary.wonSum)}
            {!isTime &&
              groups.length > CHART_TOP_LIMIT &&
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
            {formatNumber(groups.length)} групп — сортировка по клику на
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
              rows={tableRows.map((row) => [
                row.label,
                row.deals,
                row.won,
                (row.conversionRate * 100).toFixed(1),
                Math.round(row.wonSum),
                Math.round(row.opportunitySum),
              ])}
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
              {tableRows.length === 0 ? (
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
        </CardContent>
      </Card>
    </div>
  );
}
