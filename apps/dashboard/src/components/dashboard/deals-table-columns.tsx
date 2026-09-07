import type { DealStatus } from "@psi-opora/db/queries";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { StageInfo } from "@/lib/analytics/deals";
import { STATUS_LABEL } from "@/lib/analytics/status-label";
import type { DealRowDTO } from "@/lib/api/deals-schema";
import { dealUrl } from "@/lib/deal-url";
import { formatMoney } from "@/lib/format";

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

interface BuildColumnsParams {
	sourceNames?: Map<string, string>;
	categoryNames?: Map<string, string>;
	stageNames?: Map<string, StageInfo>;
	failReasonNames?: Map<string, string>;
	dealDomain?: string | null;
}

export function buildColumns({
	sourceNames,
	categoryNames,
	stageNames,
	failReasonNames,
	dealDomain,
}: BuildColumnsParams): ColumnDef<DealRowDTO>[] {
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
					</a>
				) : (
					<span className="block max-w-72 truncate font-medium">
						{deal.title}
					</span>
				);

				return (
					<div className="flex flex-col gap-0.5">
						{title}
						{deal.utmCampaign && (
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
			cell: ({ getValue }) => {
				const info = STATUS_LABEL[getValue<DealStatus>()];
				return <Badge variant={info.variant}>{info.label}</Badge>;
			},
		},
		{
			id: "stage",
			header: "Стадия",
			accessorFn: (deal) => stageNames?.get(deal.stageId)?.name ?? deal.stageId,
		},
		{
			id: "category",
			header: "Воронка",
			accessorFn: (deal) =>
				categoryNames?.get(deal.categoryId) ?? `Воронка ${deal.categoryId}`,
		},
		{
			id: "source",
			header: "Источник",
			accessorFn: (deal) =>
				sourceNames?.get(deal.sourceId ?? "") ?? deal.sourceId ?? "",
			cell: ({ row, getValue }) => (
				<div className="flex flex-col gap-0.5">
					<span>{getValue<string>()}</span>
					{row.original.utmSource && (
						<span className="text-xs text-muted-foreground">
							UTM: {row.original.utmSource}
						</span>
					)}
				</div>
			),
		},
		{
			id: "failReason",
			header: "Причина провала",
			accessorFn: (deal) =>
				deal.failReasonId
					? (failReasonNames?.get(deal.failReasonId) ?? deal.failReasonId)
					: "",
		},
		{
			accessorKey: "opportunity",
			header: sortableHeader("Сумма"),
			cell: ({ row }) => (
				<span className="tabular-nums">
					{formatMoney(
						row.original.opportunity,
						row.original.currency ?? undefined,
					)}
				</span>
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
