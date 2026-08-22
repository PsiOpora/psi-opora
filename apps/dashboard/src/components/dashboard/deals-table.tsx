"use client";

import type { DealStatus } from "@psi-opora/db/queries";
import { useQuery } from "@tanstack/react-query";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  type PaginationState,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  FilterXIcon,
  InfoIcon,
  Loader2Icon,
  SearchIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
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
import { formatDateParam } from "@/lib/analytics/date-range";
import type { StageInfo } from "@/lib/analytics/deals";
import { STATUS_LABEL } from "@/lib/analytics/status-label";
import { DealsResponseSchema, type DealRowDTO } from "@/lib/api/deals-schema";
import { dealUrl } from "@/lib/deal-url";
import { formatMoney, formatNumber } from "@/lib/format";

const PAGE_SIZE = 20;
const ALL = "__all";
/** Задержка перед отправкой запроса на сервер после ввода в поиск — без неё
 * каждое нажатие клавиши гоняло бы отдельный HTTP-запрос. */
const SEARCH_DEBOUNCE_MS = 300;

interface DealsTableProps {
  sourceNames?: Map<string, string>;
  categoryNames?: Map<string, string>;
  stageNames?: Map<string, StageInfo>;
  dealDomain?: string | null;
  /** Начальные значения фильтров — например, при переходе из другого отчёта. */
  initialStatus?: string;
  initialCategory?: string;
  initialStage?: string;
  initialSource?: string;
  initialSearch?: string;
  /**
   * Показать сделки, у которых была история входа на конкретный этап
   * (packages/db, таблица deal_stage_history) в текущем диапазоне дат
   * (общий DateRangePicker), а не отфильтрованные по дате создания. Ссылка
   * приходит с историческую воронки (funnel/page.tsx, режим "Достигли этапа").
   */
  reachedStage?: { stageId: string; categoryId: string; stageLabel: string };
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function sortableHeader(label: string) {
  return function Header({
    column,
  }: {
    column: {
      toggleSorting: (desc?: boolean) => void;
      getIsSorted: () => false | "asc" | "desc";
    };
  }) {
    const direction = column.getIsSorted();
    const SortIcon =
      direction === "asc"
        ? ArrowUpIcon
        : direction === "desc"
          ? ArrowDownIcon
          : ArrowUpDownIcon;

    return (
      <Button
        variant="ghost"
        size="sm"
        className="-ml-3"
        onClick={() => column.toggleSorting(direction === "asc")}
      >
        {label}
        <SortIcon data-icon="inline-end" />
      </Button>
    );
  };
}

function buildColumns({
  sourceNames,
  categoryNames,
  stageNames,
  dealDomain,
}: Omit<DealsTableProps, "deals">): ColumnDef<DealRowDTO>[] {
  return [
    {
      accessorKey: "title",
      header: sortableHeader("Сделка"),
      cell: ({ row }) => {
        const deal = row.original;
        const title = dealDomain ? (
          <a
            href={dealUrl(dealDomain, deal.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex max-w-72 items-center gap-1 font-medium hover:underline"
          >
            <span className="truncate">{deal.title}</span>
          </a>
        ) : (
          <span className="block max-w-72 truncate font-medium">
            {deal.title}
          </span>
        );

        return (
          <div className="flex flex-col gap-0.5">
            {title}
            {deal.utmCampaign && (
              <span className="max-w-72 truncate text-xs text-muted-foreground">
                {deal.utmCampaign}
              </span>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: sortableHeader("Статус"),
      cell: ({ getValue }) => {
        const info = STATUS_LABEL[getValue<DealStatus>()];
        return <Badge variant={info.variant}>{info.label}</Badge>;
      },
    },
    {
      id: "stage",
      header: "Стадия",
      accessorFn: (deal) => stageNames?.get(deal.stageId)?.name ?? deal.stageId,
    },
    {
      id: "category",
      header: "Воронка",
      accessorFn: (deal) =>
        categoryNames?.get(deal.categoryId) ?? `Воронка ${deal.categoryId}`,
    },
    {
      id: "source",
      header: "Источник",
      accessorFn: (deal) =>
        sourceNames?.get(deal.sourceId ?? "") ?? deal.sourceId ?? "",
      cell: ({ row, getValue }) => (
        <div className="flex flex-col gap-0.5">
          <span>{getValue<string>()}</span>
          {row.original.utmSource && (
            <span className="text-xs text-muted-foreground">
              UTM: {row.original.utmSource}
            </span>
          )}
        </div>
      ),
    },
    {
      accessorKey: "opportunity",
      header: sortableHeader("Сумма"),
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatMoney(row.original.opportunity, row.original.currency ?? undefined)}
        </span>
      ),
    },
    {
      accessorKey: "dateCreate",
      header: sortableHeader("Создана"),
      cell: ({ getValue }) => new Date(getValue<string>()).toLocaleDateString("ru-RU"),
    },
  ];
}

export function DealsTable({
  sourceNames,
  categoryNames,
  stageNames,
  dealDomain,
  initialStatus,
  initialCategory,
  initialStage,
  initialSource,
  initialSearch,
  reachedStage,
}: DealsTableProps) {
  const range = useDashboardRange();
  const [sorting, setSorting] = useState<SortingState>([
    { id: "dateCreate", desc: true },
  ]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  });
  const [searchInput, setSearchInput] = useState(initialSearch ?? "");
  const search = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);
  const [status, setStatus] = useState(initialStatus ?? ALL);
  const [category, setCategory] = useState(initialCategory ?? ALL);
  const [stage, setStage] = useState(initialStage ?? ALL);
  const [source, setSource] = useState(initialSource ?? ALL);

  // Reset pagination when range changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: range is intentionally used only to trigger the reset, not read inside the effect
  useEffect(() => {
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  }, [range]);

  const columns = useMemo(
    () => buildColumns({ sourceNames, categoryNames, stageNames, dealDomain }),
    [sourceNames, categoryNames, stageNames, dealDomain],
  );

  // Справочники Bitrix24 уже содержат ВСЕ категории/стадии/источники CRM
  // (не только те, что попали в текущую страницу) — используем их напрямую
  // вместо сканирования уже загруженных сделок.
  const categoryOptions = useMemo(
    () =>
      [...(categoryNames ?? new Map()).entries()]
        .map(([id, label]) => ({ id, label }))
        .sort((a, b) => a.label.localeCompare(b.label, "ru")),
    [categoryNames],
  );
  const stageOptions = useMemo(
    () =>
      [...(stageNames ?? new Map()).entries()]
        .map(([id, info]) => ({ id, label: info.name }))
        .sort((a, b) => a.label.localeCompare(b.label, "ru")),
    [stageNames],
  );
  const sourceOptions = useMemo(
    () =>
      [...(sourceNames ?? new Map()).entries()]
        .map(([id, label]) => ({ id, label }))
        .sort((a, b) => a.label.localeCompare(b.label, "ru")),
    [sourceNames],
  );

  const sort = sorting[0];
  const sortField = sort?.id === "opportunity" || sort?.id === "dateCreate" || sort?.id === "title" || sort?.id === "status" ? sort.id : undefined;

  const queryKey = [
    "dashboard-deals",
    formatDateParam(range.from),
    formatDateParam(range.to),
    status,
    category,
    stage,
    source,
    search,
    sortField,
    sort?.desc,
    pagination.pageIndex,
    pagination.pageSize,
    reachedStage?.stageId,
    reachedStage?.categoryId,
  ];

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({
        from: formatDateParam(range.from),
        to: formatDateParam(range.to),
        page: String(pagination.pageIndex + 1),
        pageSize: String(pagination.pageSize),
        sortDir: sort?.desc === false ? "asc" : "desc",
      });
      if (status !== ALL) params.set("status", status);
      if (category !== ALL) params.set("category", category);
      if (stage !== ALL) params.set("stage", stage);
      if (source !== ALL) params.set("source", source);
      if (search.trim()) params.set("search", search.trim());
      if (sortField) params.set("sort", sortField);
      if (reachedStage) {
        params.set("reachedStage", reachedStage.stageId);
        params.set("reachedCategory", reachedStage.categoryId);
      }

      const res = await fetch(`/api/dashboard/deals?${params}`);
      if (!res.ok) throw new Error("Не удалось загрузить сделки");
      const json = await res.json();
      return DealsResponseSchema.parse(json);
    },
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    manualSorting: true,
    manualPagination: true,
    manualFiltering: true,
    pageCount: Math.max(1, Math.ceil(total / pagination.pageSize)),
    getCoreRowModel: getCoreRowModel(),
  });

  const resetFilters = () => {
    setSearchInput("");
    setStatus(ALL);
    setCategory(ALL);
    setStage(ALL);
    setSource(ALL);
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  };
  const updateFilter = (setter: (value: string) => void, value: string) => {
    setter(value);
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  };

  const pageIndex = pagination.pageIndex;
  const pageCount = table.getPageCount();
  const from = total === 0 ? 0 : pageIndex * pagination.pageSize + 1;
  const to = Math.min(total, (pageIndex + 1) * pagination.pageSize);
  const hasFilters =
    search.length > 0 ||
    status !== ALL ||
    category !== ALL ||
    stage !== ALL ||
    source !== ALL;

  if (isError) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>Не удалось загрузить сделки</EmptyTitle>
          <EmptyDescription>Попробуйте обновить страницу.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Попробовать снова
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {reachedStage && (
        <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          <InfoIcon className="mt-0.5 size-4 shrink-0" />
          <p>
            Показаны сделки, у которых был переход на этап «
            <span className="font-medium text-foreground">
              {reachedStage.stageLabel}
            </span>
            » с {formatDateParam(range.from)} по {formatDateParam(range.to)} —
            независимо от того, в какой стадии сделка находится сейчас, и без
            учёта даты её создания. Сделка, заходившая на этап несколько раз,
            показана один раз.
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Поиск сделок"
            placeholder="Название, UTM, стадия или источник…"
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.target.value);
              setPagination((current) => ({ ...current, pageIndex: 0 }));
            }}
            className="pl-8"
          />
        </div>
        <Select
          value={status}
          onValueChange={(value) => updateFilter(setStatus, value)}
        >
          <SelectTrigger aria-label="Фильтр по статусу" className="min-w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>Все статусы</SelectItem>
              {(
                Object.entries(STATUS_LABEL) as Array<
                  [DealStatus, (typeof STATUS_LABEL)[DealStatus]]
                >
              ).map(([value, info]) => (
                <SelectItem key={value} value={value}>
                  {info.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          value={category}
          onValueChange={(value) => updateFilter(setCategory, value)}
        >
          <SelectTrigger aria-label="Фильтр по воронке" className="min-w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>Все воронки</SelectItem>
              {categoryOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          value={stage}
          onValueChange={(value) => updateFilter(setStage, value)}
        >
          <SelectTrigger aria-label="Фильтр по стадии" className="min-w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>Все стадии</SelectItem>
              {stageOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          value={source}
          onValueChange={(value) => updateFilter(setSource, value)}
        >
          <SelectTrigger aria-label="Фильтр по источнику" className="min-w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>Все источники</SelectItem>
              {sourceOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            <FilterXIcon data-icon="inline-start" />
            Сбросить
          </Button>
        )}
        {isFetching && !isLoading && (
          <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {!isLoading && total === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchIcon />
            </EmptyMedia>
            <EmptyTitle>Сделки не найдены</EmptyTitle>
            <EmptyDescription>
              Измените поисковый запрос или сбросьте выбранные фильтры.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" size="sm" onClick={resetFilters}>
              Сбросить фильтры
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-24 text-center text-muted-foreground"
                    >
                      Загрузка…
                    </TableCell>
                  </TableRow>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <TableRow key={row.id}>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>
              {formatNumber(from)}–{formatNumber(to)} из {formatNumber(total)}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                Назад
              </Button>
              <span className="tabular-nums">
                {pageIndex + 1} / {Math.max(pageCount, 1)}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                Вперёд
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
