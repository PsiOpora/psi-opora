"use client";

import { useState } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { dealUrl } from "@/lib/deal-url";
import type { DealStatus, GroupStats } from "@/lib/analytics/types";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";

const STATUS_LABEL: Record<
  DealStatus,
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  won: { label: "Выиграна", variant: "default" },
  lost: { label: "Проиграна", variant: "destructive" },
  in_progress: { label: "В работе", variant: "secondary" },
};

export function GroupStatsTable({
  columnLabel,
  data,
  dealDomain,
}: {
  columnLabel: string;
  data: GroupStats[];
  /** Домен портала Bitrix24 — если известен, сделки в шторке ведут на карточку CRM. */
  dealDomain?: string | null;
}) {
  const [selected, setSelected] = useState<GroupStats | null>(null);

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{columnLabel}</TableHead>
            <TableHead className="text-right">Сделок</TableHead>
            <TableHead className="text-right">Выиграно</TableHead>
            <TableHead className="text-right">Конверсия</TableHead>
            <TableHead className="text-right">Сумма выигранных</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row) => (
            <TableRow
              key={row.key}
              className="cursor-pointer"
              onClick={() => setSelected(row)}
            >
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
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Sheet
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{selected?.label}</SheetTitle>
            <SheetDescription>
              {selected ? `${formatNumber(selected.deals)} сделок` : ""}
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-1 overflow-y-auto px-4 pb-4">
            {selected?.items.map((deal) => {
              const info = STATUS_LABEL[deal.status];
              const href = dealDomain ? dealUrl(dealDomain, deal.id) : null;
              const content = (
                <>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium">
                      {deal.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {deal.dateCreate.toLocaleDateString("ru-RU")} ·{" "}
                      {formatMoney(deal.opportunity)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={info.variant}>{info.label}</Badge>
                    {href && (
                      <ExternalLinkIcon className="size-3.5 text-muted-foreground" />
                    )}
                  </div>
                </>
              );
              return href ? (
                <a
                  key={deal.id}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-2 hover:bg-muted/60"
                >
                  {content}
                </a>
              ) : (
                <div
                  key={deal.id}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-2"
                >
                  {content}
                </div>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
