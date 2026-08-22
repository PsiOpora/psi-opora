"use client";

import type { DealGroupDimension } from "@psi-opora/db/queries";
import { useState } from "react";
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
import type { DateRange } from "@/lib/analytics/types";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import {
	GroupDealsDialog,
	type GroupDealsSelection,
} from "./group-deals-dialog";

export interface GroupStatsRow {
	key: string;
	label: string;
	deals: number;
	dealsWithAmount: number;
	won: number;
	opportunitySum: number;
	wonSum: number;
	conversionRate: number;
}

/**
 * Презентационная таблица — данные (текущая страница), сортировку и
 * пагинацию тянет вызывающая страница из /api/dashboard/deals/report
 * (packages/db/src/queries/deals.ts::groupDealsBy — SQL GROUP BY, а не JS
 * в браузере). Клик по строке открывает GroupDealsDialog со своим
 * пагинированным запросом сделок этой группы.
 */
export function GroupStatsTable({
	columnLabel,
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
}: {
	columnLabel: string;
	data: GroupStatsRow[];
	total: number;
	page: number;
	pageSize: number;
	onPageChange: (page: number) => void;
	dimension: DealGroupDimension;
	range: DateRange;
	/** Домен портала Bitrix24 — если известен, диалог со сделками ведёт на карточку CRM. */
	dealDomain?: string | null;
	/** Показывать сумму всех сделок и долю сделок, где она заполнена. */
	showOpportunity?: boolean;
	isLoading?: boolean;
	/** Выключить пагинацию — для карточек «топ-N», где показывается только первая страница. */
	showPagination?: boolean;
}) {
	const [selection, setSelection] = useState<GroupDealsSelection | null>(null);

	const pageCount = Math.max(1, Math.ceil(total / pageSize));
	const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
	const to = Math.min(total, page * pageSize);

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
					{isLoading ? (
						<TableRow>
							<TableCell
								colSpan={showOpportunity ? 6 : 4}
								className="h-24 text-center text-muted-foreground"
							>
								Загрузка…
							</TableCell>
						</TableRow>
					) : (
						data.map((row) => (
							<TableRow
								key={row.key}
								className="cursor-pointer"
								onClick={() =>
									setSelection({
										dimension,
										key: row.key,
										label: row.label,
										deals: row.deals,
										won: row.won,
										wonSum: row.wonSum,
									})
								}
							>
								<TableCell className="font-medium">{row.label}</TableCell>
								<TableCell className="text-right tabular-nums">
									{formatNumber(row.deals)}
								</TableCell>
								{showOpportunity && (
									<TableCell className="text-right">
										<Badge variant="outline">
											{formatNumber(row.dealsWithAmount)} из{" "}
											{formatNumber(row.deals)}
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
						))
					)}
				</TableBody>
			</Table>

			{showPagination && total > pageSize && (
				<div className="flex items-center justify-between gap-4 pt-3 text-sm text-muted-foreground">
					<span>
						{formatNumber(from)}–{formatNumber(to)} из {formatNumber(total)}
					</span>
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => onPageChange(Math.max(1, page - 1))}
							disabled={page <= 1}
						>
							Назад
						</Button>
						<span className="tabular-nums">
							{page} / {pageCount}
						</span>
						<Button
							variant="outline"
							size="sm"
							onClick={() => onPageChange(Math.min(pageCount, page + 1))}
							disabled={page >= pageCount}
						>
							Вперёд
						</Button>
					</div>
				</div>
			)}

			<GroupDealsDialog
				selection={selection}
				range={range}
				onOpenChange={(open) => !open && setSelection(null)}
				dealDomain={dealDomain}
			/>
		</>
	);
}
