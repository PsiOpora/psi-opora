"use client";

import { useState } from "react";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDownIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DealRecord, DealStatus } from "@/lib/analytics/types";
import { formatMoney } from "@/lib/format";

const STATUS_LABEL: Record<
  DealStatus,
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  won: { label: "Выиграна", variant: "default" },
  lost: { label: "Проиграна", variant: "destructive" },
  in_progress: { label: "В работе", variant: "secondary" },
};

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
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        {label}
        <ArrowUpDownIcon data-icon="inline-end" />
      </Button>
    );
  };
}

const columns: ColumnDef<DealRecord>[] = [
  { accessorKey: "title", header: sortableHeader("Сделка") },
  {
    accessorKey: "status",
    header: "Статус",
    cell: ({ getValue }) => {
      const status = getValue<DealStatus>();
      const info = STATUS_LABEL[status];
      return <Badge variant={info.variant}>{info.label}</Badge>;
    },
  },
  { accessorKey: "utmSource", header: sortableHeader("UTM source") },
  { accessorKey: "utmCampaign", header: sortableHeader("UTM campaign") },
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

export function DealsTable({ deals }: { deals: DealRecord[] }) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "dateCreate", desc: true },
  ]);

  const table = useReactTable({
    data: deals,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
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
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id}>
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
