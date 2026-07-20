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
}: {
  title: string;
  description: string;
  hint?: string;
  columnLabel: string;
  csvName: string;
  data: GroupStats[];
}) {
  const csvRows = data.map((row) => [
    row.label,
    row.deals,
    row.won,
    (row.conversionRate * 100).toFixed(1),
    Math.round(row.wonSum),
    Math.round(row.opportunitySum),
  ]);

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
            headers={[
              columnLabel,
              "Сделок",
              "Выиграно",
              "Конверсия, %",
              "Сумма выигранных",
              "Сумма в воронке",
            ]}
            rows={csvRows}
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        <GroupStatsTable columnLabel={columnLabel} data={data} />
      </CardContent>
    </Card>
  );
}
