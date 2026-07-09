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

export function GroupStatsTable({
  columnLabel,
  data,
}: {
  columnLabel: string;
  data: GroupStats[];
}) {
  return (
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
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
