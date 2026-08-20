"use client";

import { useMemo, useState } from "react";
import {
	type ColumnDef,
	type SortingState,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDownIcon, ExternalLinkIcon, SearchIcon } from "lucide-react";
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
import { STATUS_LABEL } from "@/lib/analytics/status-label";
import type { DealSummary, GroupStats } from "@/lib/analytics/types";
import { dealUrl } from "@/lib/deal-url";
import { formatMoney, formatNumber } from "@/lib/format";

const PAGE_SIZE = 10;

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

function buildColumns(dealDomain?: string | null): ColumnDef<DealSummary>[] {
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
				const info = STATUS_LABEL[getValue<DealSummary["status"]>()];
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
			cell: ({ getValue }) => getValue<Date>().toLocaleDateString("ru-RU"),
		},
	];
}

export function GroupDealsDialog({
	group,
	onOpenChange,
	dealDomain,
}: {
	group: GroupStats | null;
	onOpenChange: (open: boolean) => void;
	/** Домен портала Bitrix24 — если известен, названия сделок ведут на карточку CRM. */
	dealDomain?: string | null;
}) {
	const [sorting, setSorting] = useState<SortingState>([
		{ id: "dateCreate", desc: true },
	]);
	const [search, setSearch] = useState("");
	const columns = useMemo(() => buildColumns(dealDomain), [dealDomain]);

	const table = useReactTable({
		data: group?.items ?? [],
		columns,
		state: { sorting, globalFilter: search },
		onSortingChange: setSorting,
		onGlobalFilterChange: setSearch,
		globalFilterFn: "includesString",
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		initialState: { pagination: { pageSize: PAGE_SIZE } },
	});

	const rows = table.getRowModel().rows;
	const total = table.getFilteredRowModel().rows.length;
	const pageIndex = table.getState().pagination.pageIndex;
	const pageCount = table.getPageCount();
	const from = total === 0 ? 0 : pageIndex * PAGE_SIZE + 1;
	const to = Math.min(total, (pageIndex + 1) * PAGE_SIZE);

	return (
		<Dialog
			open={group !== null}
			onOpenChange={(open) => {
				onOpenChange(open);
				if (!open) {
					setSearch("");
					table.setPageIndex(0);
				}
			}}
		>
			<DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>{group?.label}</DialogTitle>
					<DialogDescription>
						{group &&
							`${formatNumber(group.deals)} сделок · выиграно ${formatNumber(group.won)} на сумму ${formatMoney(group.wonSum)}`}
					</DialogDescription>
				</DialogHeader>

				<div className="relative shrink-0">
					<SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						placeholder="Поиск по названию сделки…"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
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
							{rows.length === 0 ? (
								<TableRow>
									<TableCell
										colSpan={columns.length}
										className="h-24 text-center text-muted-foreground"
									>
										Ничего не найдено
									</TableCell>
								</TableRow>
							) : (
								rows.map((row) => (
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
