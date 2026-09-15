"use client";

import { useQuery } from "@tanstack/react-query";
import {
	flexRender,
	getCoreRowModel,
	type PaginationState,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import { InfoIcon, SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useDashboardRange } from "@/hooks/use-bitrix-data";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatDateParam } from "@/lib/analytics/date-range";
import type { StageInfo } from "@/lib/analytics/deals";
import { DealsResponseSchema } from "@/lib/api/deals-schema";
import { buildColumns } from "./deals-table-columns";
import { ALL, DealsTableFilters } from "./deals-table-filters";
import { DealsTablePagination } from "./deals-table-pagination";

const PAGE_SIZE = 20;
/** Задержка перед отправкой запроса на сервер после ввода в поиск — без неё
 * каждое нажатие клавиши гоняло бы отдельный HTTP-запрос. */
const SEARCH_DEBOUNCE_MS = 300;

interface DealsTableProps {
	sourceNames?: Map<string, string>;
	categoryNames?: Map<string, string>;
	stageNames?: Map<string, StageInfo>;
	failReasonNames?: Map<string, string>;
	dealDomain?: string | null;
	/** Начальные значения фильтров — например, при переходе из другого отчёта. */
	initialStatus?: string;
	initialCategory?: string;
	initialStage?: string;
	initialSource?: string;
	initialFailReason?: string;
	initialSearch?: string;
	/**
	 * Показать сделки, у которых была история входа на конкретный этап
	 * (packages/db, таблица deal_stage_history) в текущем диапазоне дат
	 * (общий DateRangePicker), а не отфильтрованные по дате создания. Ссылка
	 * приходит с историческую воронки (funnel/page.tsx, режим "Достигли этапа").
	 */
	reachedStage?: { stageId: string; categoryId: string; stageLabel: string };
}

export function DealsTable({
	sourceNames,
	categoryNames,
	stageNames,
	failReasonNames,
	dealDomain,
	initialStatus,
	initialCategory,
	initialStage,
	initialSource,
	initialFailReason,
	initialSearch,
	reachedStage,
}: DealsTableProps) {
	const router = useRouter();
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
	const [failReason, setFailReason] = useState(initialFailReason ?? ALL);

	// Reset pagination when range changes
	const rangeFrom = formatDateParam(range.from);
	const rangeTo = formatDateParam(range.to);
	// biome-ignore lint/correctness/useExhaustiveDependencies: rangeFrom/rangeTo are intentionally used only to trigger the reset, not read inside the effect
	useEffect(() => {
		setPagination((current) => ({ ...current, pageIndex: 0 }));
	}, [rangeFrom, rangeTo]);

	const columns = useMemo(
		() =>
			buildColumns({
				sourceNames,
				categoryNames,
				stageNames,
				failReasonNames,
				dealDomain,
			}),
		[sourceNames, categoryNames, stageNames, failReasonNames, dealDomain],
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
	// У разных воронок нередко совпадают названия стадий (например, "Новая"
	// или "Сделка провалена" в каждой воронке) — id стадии из Bitrix при этом
	// разный (префикс "C{categoryId}:", без префикса — воронка по умолчанию).
	// Без уточнения такие стадии выглядели бы в списке как дубли.
	const stageOptions = useMemo(() => {
		const entries = [...(stageNames ?? new Map()).entries()];
		const nameCounts = new Map<string, number>();
		for (const [, info] of entries) {
			nameCounts.set(info.name, (nameCounts.get(info.name) ?? 0) + 1);
		}
		return entries
			.map(([id, info]) => {
				const isDuplicate = (nameCounts.get(info.name) ?? 0) > 1;
				if (!isDuplicate) return { id, label: info.name };
				const categoryId = /^C(\d+):/.exec(id)?.[1] ?? "0";
				const categoryLabel = categoryNames?.get(categoryId);
				return {
					id,
					label: categoryLabel ? `${info.name} · ${categoryLabel}` : info.name,
				};
			})
			.sort((a, b) => a.label.localeCompare(b.label, "ru"));
	}, [stageNames, categoryNames]);
	const sourceOptions = useMemo(
		() =>
			[...(sourceNames ?? new Map()).entries()]
				.map(([id, label]) => ({ id, label }))
				.sort((a, b) => a.label.localeCompare(b.label, "ru")),
		[sourceNames],
	);
	const failReasonOptions = useMemo(
		() =>
			[...(failReasonNames ?? new Map()).entries()]
				.map(([id, label]) => ({ id, label }))
				.sort((a, b) => a.label.localeCompare(b.label, "ru")),
		[failReasonNames],
	);

	const sort = sorting[0];
	const sortField =
		sort?.id === "opportunity" ||
		sort?.id === "dateCreate" ||
		sort?.id === "title" ||
		sort?.id === "status"
			? sort.id
			: undefined;

	const queryKey = [
		"dashboard-deals",
		formatDateParam(range.from),
		formatDateParam(range.to),
		status,
		category,
		stage,
		source,
		failReason,
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
			if (failReason !== ALL) params.set("failReason", failReason);
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
		setFailReason(ALL);
		setPagination((current) => ({ ...current, pageIndex: 0 }));
		if (reachedStage) {
			router.push("/deals");
		}
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
		source !== ALL ||
		failReason !== ALL ||
		reachedStage !== undefined;

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
			<DealsTableFilters
				searchInput={searchInput}
				onSearchInputChange={(value) => {
					setSearchInput(value);
					setPagination((current) => ({ ...current, pageIndex: 0 }));
				}}
				status={status}
				onStatusChange={(value) => updateFilter(setStatus, value)}
				category={category}
				onCategoryChange={(value) => updateFilter(setCategory, value)}
				categoryOptions={categoryOptions}
				stage={stage}
				onStageChange={(value) => updateFilter(setStage, value)}
				stageOptions={stageOptions}
				source={source}
				onSourceChange={(value) => updateFilter(setSource, value)}
				sourceOptions={sourceOptions}
				failReason={failReason}
				onFailReasonChange={(value) => updateFilter(setFailReason, value)}
				failReasonOptions={failReasonOptions}
				hasFilters={hasFilters}
				onReset={resetFilters}
				isFetching={isFetching}
				isLoading={isLoading}
			/>

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

					<DealsTablePagination
						pageIndex={pageIndex}
						pageCount={Math.max(pageCount, 1)}
						pageSize={pagination.pageSize}
						from={from}
						to={to}
						total={total}
						canPreviousPage={table.getCanPreviousPage()}
						canNextPage={table.getCanNextPage()}
						onPageChange={(index) => table.setPageIndex(index)}
						onPageSizeChange={(size) =>
							setPagination({ pageIndex: 0, pageSize: size })
						}
					/>
				</>
			)}
		</div>
	);
}
