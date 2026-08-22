"use client";

import type {
	DealGroupDimension,
	DealRow,
	DealStatus,
} from "@psi-opora/db/queries";
import { useQuery } from "@tanstack/react-query";
import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	type PaginationState,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDownIcon, ExternalLinkIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { formatDateParam } from "@/lib/analytics/date-range";
import { STATUS_LABEL } from "@/lib/analytics/status-label";
import type { DateRange } from "@/lib/analytics/types";
import { dealUrl } from "@/lib/deal-url";
import { formatMoney, formatNumber } from "@/lib/format";

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

export interface GroupDealsSelection {
	dimension: DealGroupDimension;
	key: string;
	label: string;
	deals: number;
	won: number;
	wonSum: number;
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
		return (
			<Button
				variant="ghost"
				size="sm"
				className="-ml-3"
				onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
			>
				{label}
				<ArrowUpDownIcon data-icon="inline-end" />
			</Button>
		);
	};
}

function buildColumns(dealDomain?: string | null): ColumnDef<DealRow>[] {
	return [
		{
			accessorKey: "title",
			header: sortableHeader("Сделка"),
			cell: ({ row }) => {
				const deal = row.original;
				const href = dealDomain ? dealUrl(dealDomain, deal.id) : null;
				if (!href) {
					return <span className="font-medium">{deal.title}</span>;
				}
				return (
					<a
						href={href}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-1 font-medium hover:underline"
					>
						{deal.title}
						<ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
					</a>
				);
			},
		},
		{
			accessorKey: "status",
			header: "Статус",
			cell: ({ getValue }) => {
				const info = STATUS_LABEL[getValue<DealStatus>()];
				return <Badge variant={info.variant}>{info.label}</Badge>;
			},
		},
		{
			accessorKey: "opportunity",
			header: sortableHeader("Сумма"),
			cell: ({ getValue }) => (
				<span className="tabular-nums">{formatMoney(getValue<number>())}</span>
			),
		},
		{
			accessorKey: "dateCreate",
			header: sortableHeader("Создана"),
			cell: ({ getValue }) =>
				new Date(getValue<string>()).toLocaleDateString("ru-RU"),
		},
	];
}

export function GroupDealsDialog({
	selection,
	range,
	onOpenChange,
	dealDomain,
}: {
	selection: GroupDealsSelection | null;
	range: DateRange;
	onOpenChange: (open: boolean) => void;
	/** Домен портала Bitrix24 — если известен, названия сделок ведут на карточку CRM. */
	dealDomain?: string | null;
}) {
	const [sorting, setSorting] = useState<SortingState>([
		{ id: "dateCreate", desc: true },
	]);
	const [pagination, setPagination] = useState<PaginationState>({
		pageIndex: 0,
		pageSize: PAGE_SIZE,
	});
	const [searchInput, setSearchInput] = useState("");
	const search = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);
	const columns = useMemo(() => buildColumns(dealDomain), [dealDomain]);

	const sort = sorting[0];
	const sortField =
		sort?.id === "title" || sort?.id === "status" || sort?.id === "opportunity" || sort?.id === "dateCreate"
			? sort.id
			: undefined;

	const {
		data,
		isLoading,
		isError,
		refetch,
	} = useQuery({
		queryKey: [
			"dashboard-group-deals",
			selection?.dimension,
			selection?.key,
			formatDateParam(range.from),
			formatDateParam(range.to),
			search,
			sortField,
			sort?.desc,
			pagination.pageIndex,
		],
		queryFn: async () => {
			if (!selection) return { rows: [], total: 0 };
			const params = new URLSearchParams({
				dimension: selection.dimension,
				key: selection.key,
				from: formatDateParam(range.from),
				to: formatDateParam(range.to),
				page: String(pagination.pageIndex + 1),
				pageSize: String(pagination.pageSize),
				sortDir: sort?.desc === false ? "asc" : "desc",
			});
			if (search.trim()) params.set("search", search.trim());
			if (sortField) params.set("sort", sortField);

			const res = await fetch(`/api/dashboard/deals/group?${params}`);
			if (!res.ok) throw new Error("Не удалось загрузить сделки группы");
			return (await res.json()) as { rows: DealRow[]; total: number };
		},
		enabled: selection !== null,
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

	const pageIndex = pagination.pageIndex;
	const pageCount = table.getPageCount();
	const from = total === 0 ? 0 : pageIndex * PAGE_SIZE + 1;
	const to = Math.min(total, (pageIndex + 1) * PAGE_SIZE);

	return (
		<Dialog
			open={selection !== null}
			onOpenChange={(open) => {
				onOpenChange(open);
				if (!open) {
					setSearchInput("");
					setPagination((current) => ({ ...current, pageIndex: 0 }));
				}
			}}
		>
			<DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>{selection?.label}</DialogTitle>
					<DialogDescription>
						{selection &&
							`${formatNumber(selection.deals)} сделок · выиграно ${formatNumber(selection.won)} на сумму ${formatMoney(selection.wonSum)}`}
					</DialogDescription>
				</DialogHeader>

				<div className="relative shrink-0">
					<SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						placeholder="Поиск по названию сделки…"
						value={searchInput}
						onChange={(e) => {
							setSearchInput(e.target.value);
							setPagination((current) => ({ ...current, pageIndex: 0 }));
						}}
						className="pl-8"
					/>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
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
							) : isError ? (
								<TableRow>
									<TableCell colSpan={columns.length} className="h-24 text-center">
										<div className="flex flex-col items-center gap-2">
											<p className="text-sm text-destructive">
												Не удалось загрузить сделки группы.
											</p>
											<Button
												variant="outline"
												size="sm"
												onClick={() => void refetch()}
											>
												Попробовать снова
											</Button>
										</div>
									</TableCell>
								</TableRow>
							) : rows.length === 0 ? (
								<TableRow>
									<TableCell
										colSpan={columns.length}
										className="h-24 text-center text-muted-foreground"
									>
										Ничего не найдено
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

				<div className="flex shrink-0 items-center justify-between gap-4 text-sm text-muted-foreground">
					<span>
						{total > 0
							? `${formatNumber(from)}–${formatNumber(to)} из ${formatNumber(total)}`
							: "0 из 0"}
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
							{pageCount === 0 ? 0 : pageIndex + 1} / {Math.max(pageCount, 1)}
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
			</DialogContent>
		</Dialog>
	);
}
