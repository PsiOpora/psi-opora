import type { DealGroupDimension } from "@psi-opora/db/queries";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type { DateRange } from "@/lib/analytics/types";
import { ExportCsvButton } from "./export-csv-button";
import { GroupStatsTable, type GroupStatsRow } from "./group-stats-table";
import { InfoHint } from "./info-hint";

export function GroupStatsCard({
	title,
	description,
	hint,
	columnLabel,
	csvName,
	data,
	total,
	page,
	pageSize,
	onPageChange,
	dimension,
	range,
	dealDomain,
	showOpportunity = false,
	isLoading = false,
	showPagination = true,
	getAllRows,
}: {
	title: string;
	description: string;
	hint?: string;
	columnLabel: string;
	csvName: string;
	data: GroupStatsRow[];
	total: number;
	page: number;
	pageSize: number;
	onPageChange: (page: number) => void;
	dimension: DealGroupDimension;
	range: DateRange;
	dealDomain?: string | null;
	showOpportunity?: boolean;
	isLoading?: boolean;
	showPagination?: boolean;
	/** Загрузка всех строк разреза (без пагинации) — для CSV-экспорта по требованию. */
	getAllRows: () => Promise<GroupStatsRow[]>;
}) {
	function toCsvRow(row: GroupStatsRow): Array<string | number> {
		return showOpportunity
			? [
					row.label,
					row.deals,
					row.dealsWithAmount,
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
				];
	}

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
						getRows={async () => (await getAllRows()).map(toCsvRow)}
					/>
				</CardAction>
			</CardHeader>
			<CardContent>
				<GroupStatsTable
					columnLabel={columnLabel}
					data={data}
					total={total}
					page={page}
					pageSize={pageSize}
					onPageChange={onPageChange}
					dimension={dimension}
					range={range}
					dealDomain={dealDomain}
					showOpportunity={showOpportunity}
					isLoading={isLoading}
					showPagination={showPagination}
				/>
			</CardContent>
		</Card>
	);
}
