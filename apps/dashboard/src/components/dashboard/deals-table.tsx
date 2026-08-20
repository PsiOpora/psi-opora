"use client";

import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	type PaginationState,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import {
	ArrowDownIcon,
	ArrowUpDownIcon,
	ArrowUpIcon,
	ExternalLinkIcon,
	FilterXIcon,
	SearchIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
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
import type { StageInfo } from "@/lib/analytics/deals";
import { STATUS_LABEL } from "@/lib/analytics/status-label";
import type { DealRecord, DealStatus } from "@/lib/analytics/types";
import { dealUrl } from "@/lib/deal-url";
import { formatMoney, formatNumber } from "@/lib/format";

const PAGE_SIZE = 20;
const ALL = "__all";

interface DealsTableProps {
	deals: DealRecord[];
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
}: Omit<DealsTableProps, "deals">): ColumnDef<DealRecord>[] {
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
						<ExternalLinkIcon className="shrink-0 text-muted-foreground" />
					</a>
				) : (
					<span className="block max-w-72 truncate font-medium">
						{deal.title}
					</span>
				);

				return (
					<div className="flex flex-col gap-0.5">
						{title}
						{deal.utmCampaign !== "(не указано)" && (
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
			sortingFn: (rowA, rowB, columnId) =>
				STATUS_LABEL[rowA.getValue<DealStatus>(columnId)].label.localeCompare(
					STATUS_LABEL[rowB.getValue<DealStatus>(columnId)].label,
					"ru",
				),
			cell: ({ getValue }) => {
				const info = STATUS_LABEL[getValue<DealStatus>()];
				return <Badge variant={info.variant}>{info.label}</Badge>;
			},
		},
		{
			id: "stage",
			accessorFn: (deal) => stageNames?.get(deal.stageId)?.name ?? deal.stageId,
			header: sortableHeader("Стадия"),
		},
		{
			id: "category",
			accessorFn: (deal) =>
				categoryNames?.get(deal.categoryId) ?? `Воронка ${deal.categoryId}`,
			header: sortableHeader("Воронка"),
		},
		{
			id: "source",
			accessorFn: (deal) => sourceNames?.get(deal.sourceId) ?? deal.sourceId,
			header: sortableHeader("Источник"),
			cell: ({ row, getValue }) => (
				<div className="flex flex-col gap-0.5">
					<span>{getValue<string>()}</span>
					{row.original.utmSource !== "(не указано)" && (
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
					{formatMoney(row.original.opportunity, row.original.currency)}
				</span>
			),
		},
		{
			accessorKey: "dateCreate",
			header: sortableHeader("Создана"),
			cell: ({ getValue }) => getValue<Date>().toLocaleDateString("ru-RU"),
		},
	];
}

function includesSearch(
	deal: DealRecord,
	search: string,
	sourceNames?: Map<string, string>,
	categoryNames?: Map<string, string>,
	stageNames?: Map<string, StageInfo>,
): boolean {
	if (!search) return true;
	const query = search.toLocaleLowerCase("ru-RU");
	return [
		deal.id,
		deal.title,
		deal.utmSource,
		deal.utmMedium,
		deal.utmCampaign,
		deal.utmContent,
		deal.utmTerm,
		sourceNames?.get(deal.sourceId),
		categoryNames?.get(deal.categoryId),
		stageNames?.get(deal.stageId)?.name,
	].some((value) => value?.toLocaleLowerCase("ru-RU").includes(query));
}

export function DealsTable({
	deals,
	sourceNames,
	categoryNames,
	stageNames,
	dealDomain,
	initialStatus,
	initialCategory,
	initialStage,
	initialSource,
	initialSearch,
}: DealsTableProps) {
	const [sorting, setSorting] = useState<SortingState>([
		{ id: "dateCreate", desc: true },
	]);
	const [pagination, setPagination] = useState<PaginationState>({
		pageIndex: 0,
		pageSize: PAGE_SIZE,
	});
	const [search, setSearch] = useState(initialSearch ?? "");
	const [status, setStatus] = useState(initialStatus ?? ALL);
	const [category, setCategory] = useState(initialCategory ?? ALL);
	const [stage, setStage] = useState(initialStage ?? ALL);
	const [source, setSource] = useState(initialSource ?? ALL);

	const columns = useMemo(
		() => buildColumns({ sourceNames, categoryNames, stageNames, dealDomain }),
		[sourceNames, categoryNames, stageNames, dealDomain],
	);

	const filteredDeals = useMemo(
		() =>
			deals.filter(
				(deal) =>
					(status === ALL || deal.status === status) &&
					(category === ALL || deal.categoryId === category) &&
					(stage === ALL || deal.stageId === stage) &&
					(source === ALL || deal.sourceId === source) &&
					includesSearch(
						deal,
						search.trim(),
						sourceNames,
						categoryNames,
						stageNames,
					),
			),
		[
			deals,
			status,
			category,
			stage,
			source,
			search,
			sourceNames,
			categoryNames,
			stageNames,
		],
	);

	const categoryOptions = useMemo(
		() =>
			[...new Set(deals.map((deal) => deal.categoryId))]
				.map((id) => ({
					id,
					label: categoryNames?.get(id) ?? `Воронка ${id}`,
				}))
				.sort((a, b) => a.label.localeCompare(b.label, "ru")),
		[deals, categoryNames],
	);
	const stageOptions = useMemo(
		() =>
			[...new Set(deals.map((deal) => deal.stageId))]
				.map((id) => ({ id, label: stageNames?.get(id)?.name ?? id }))
				.sort((a, b) => a.label.localeCompare(b.label, "ru")),
		[deals, stageNames],
	);
	const sourceOptions = useMemo(
		() =>
			[...new Set(deals.map((deal) => deal.sourceId))]
				.map((id) => ({ id, label: sourceNames?.get(id) ?? id }))
				.sort((a, b) => a.label.localeCompare(b.label, "ru")),
		[deals, sourceNames],
	);

	const table = useReactTable({
		data: filteredDeals,
		columns,
		state: { sorting, pagination },
		onSortingChange: setSorting,
		onPaginationChange: setPagination,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
	});

	const resetFilters = () => {
		setSearch("");
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

	const rows = table.getRowModel().rows;
	const pageIndex = table.getState().pagination.pageIndex;
	const pageCount = table.getPageCount();
	const from = filteredDeals.length === 0 ? 0 : pageIndex * PAGE_SIZE + 1;
	const to = Math.min(filteredDeals.length, (pageIndex + 1) * PAGE_SIZE);
	const hasFilters =
		search.length > 0 ||
		status !== ALL ||
		category !== ALL ||
		stage !== ALL ||
		source !== ALL;

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-2">
				<div className="relative min-w-56 flex-1">
					<SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						aria-label="Поиск сделок"
						placeholder="Название, UTM, стадия или источник…"
						value={search}
						onChange={(event) => updateFilter(setSearch, event.target.value)}
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
			</div>

			{filteredDeals.length === 0 ? (
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
								{rows.map((row) => (
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
								))}
							</TableBody>
						</Table>
					</div>

					<div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
						<span>
							{formatNumber(from)}–{formatNumber(to)} из{" "}
							{formatNumber(filteredDeals.length)}
							{hasFilters && ` · всего ${formatNumber(deals.length)}`}
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
