"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { GroupStats } from "@/lib/analytics/types";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { GroupDealsDialog } from "./group-deals-dialog";

export function GroupStatsTable({
  columnLabel,
  data,
  dealDomain,
  showOpportunity = false,
}: {
  columnLabel: string;
  data: GroupStats[];
  /** Домен портала Bitrix24 — если известен, диалог со сделками ведёт на карточку CRM. */
  dealDomain?: string | null;
  /** Показывать сумму всех сделок и долю сделок, где она заполнена. */
  showOpportunity?: boolean;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = data.find((row) => row.key === selectedKey) ?? null;

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{columnLabel}</TableHead>
            <TableHead className="text-right">Сделок</TableHead>
            {showOpportunity && (
              <TableHead className="text-right">С суммой</TableHead>
            )}
            <TableHead className="text-right">Выиграно</TableHead>
            <TableHead className="text-right">Конверсия</TableHead>
            {showOpportunity && (
              <TableHead className="text-right">Сумма в воронке</TableHead>
            )}
            <TableHead className="text-right">Сумма выигранных</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row) => (
            <TableRow
              key={row.key}
              className="cursor-pointer"
              onClick={() => setSelectedKey(row.key)}
            >
              <TableCell className="font-medium">{row.label}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(row.deals)}
              </TableCell>
              {showOpportunity && (
                <TableCell className="text-right">
                  <Badge variant="outline">
                    {formatNumber(
                      row.items.filter((deal) => deal.opportunity > 0).length,
                    )}{" "}
                    из {formatNumber(row.deals)}
                  </Badge>
                </TableCell>
              )}
              <TableCell className="text-right tabular-nums">
                {formatNumber(row.won)}
              </TableCell>
              <TableCell className="text-right">
                <Badge variant="secondary">
                  {formatPercent(row.conversionRate)}
                </Badge>
              </TableCell>
              {showOpportunity && (
                <TableCell className="text-right tabular-nums">
                  {formatMoney(row.opportunitySum)}
                </TableCell>
              )}
              <TableCell className="text-right tabular-nums">
                {formatMoney(row.wonSum)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <GroupDealsDialog
        group={selected}
        onOpenChange={(open) => !open && setSelectedKey(null)}
        dealDomain={dealDomain}
      />
    </>
  );
}
