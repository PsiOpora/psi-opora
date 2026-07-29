import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { GroupStats } from "@/lib/analytics/types";
import { ExportCsvButton } from "./export-csv-button";
import { GroupStatsTable } from "./group-stats-table";
import { InfoHint } from "./info-hint";

export function GroupStatsCard({
  title,
  description,
  hint,
  columnLabel,
  csvName,
  data,
  dealDomain,
  showOpportunity = false,
}: {
  title: string;
  description: string;
  hint?: string;
  columnLabel: string;
  csvName: string;
  data: GroupStats[];
  dealDomain?: string | null;
  showOpportunity?: boolean;
}) {
  const csvHeaders = showOpportunity
    ? [
        columnLabel,
        "Сделок",
        "Сделок с суммой",
        "Выиграно",
        "Конверсия, %",
        "Сумма в воронке",
        "Сумма выигранных",
      ]
    : [
        columnLabel,
        "Сделок",
        "Выиграно",
        "Конверсия, %",
        "Сумма выигранных",
        "Сумма в воронке",
      ];

  const csvRows = data.map((row) =>
    showOpportunity
      ? [
          row.label,
          row.deals,
          countDealsWithAmount(row),
          row.won,
          (row.conversionRate * 100).toFixed(1),
          Math.round(row.opportunitySum),
          Math.round(row.wonSum),
        ]
      : [
          row.label,
          row.deals,
          row.won,
          (row.conversionRate * 100).toFixed(1),
          Math.round(row.wonSum),
          Math.round(row.opportunitySum),
        ],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          {title}
          {hint && <InfoHint text={hint} />}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <ExportCsvButton
            filename={csvName}
            headers={csvHeaders}
            rows={csvRows}
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        <GroupStatsTable
          columnLabel={columnLabel}
          data={data}
          dealDomain={dealDomain}
          showOpportunity={showOpportunity}
        />
      </CardContent>
    </Card>
  );
}

function countDealsWithAmount(row: GroupStats): number {
  return row.items.filter((deal) => deal.opportunity > 0).length;
}
