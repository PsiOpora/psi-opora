"use client";

import { useMemo, useState } from "react";
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
import type { GroupStats } from "@/lib/analytics/types";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { GroupDealsDialog } from "./group-deals-dialog";

const PAGE_SIZE = 20;

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
	const [pageIndex, setPageIndex] = useState(0);
	const selected = data.find((row) => row.key === selectedKey) ?? null;

	// При большом количестве уникальных значений разреза (utm_term/utm_content
	// на CRM с большим объёмом сделок легко доходят до сотен строк) рендер всей
	// таблицы разом ощутимо нагружает DOM/скрипт-поток браузера — пагинируем.
	const pageCount = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
	const clampedPageIndex = Math.min(pageIndex, pageCount - 1);
	const page = useMemo(
		() =>
			data.slice(
				clampedPageIndex * PAGE_SIZE,
				clampedPageIndex * PAGE_SIZE + PAGE_SIZE,
			),
		[data, clampedPageIndex],
	);
	const from = data.length === 0 ? 0 : clampedPageIndex * PAGE_SIZE + 1;
	const to = Math.min(data.length, (clampedPageIndex + 1) * PAGE_SIZE);

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
					{page.map((row) => (
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

			{data.length > PAGE_SIZE && (
				<div className="flex items-center justify-between gap-4 pt-3 text-sm text-muted-foreground">
					<span>
						{formatNumber(from)}–{formatNumber(to)} из{" "}
						{formatNumber(data.length)}
					</span>
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
							disabled={clampedPageIndex === 0}
						>
							Назад
						</Button>
						<span className="tabular-nums">
							{clampedPageIndex + 1} / {pageCount}
						</span>
						<Button
							variant="outline"
							size="sm"
							onClick={() =>
								setPageIndex((i) => Math.min(pageCount - 1, i + 1))
							}
							disabled={clampedPageIndex >= pageCount - 1}
						>
							Вперёд
						</Button>
					</div>
				</div>
			)}

			<GroupDealsDialog
				group={selected}
				onOpenChange={(open) => !open && setSelectedKey(null)}
				dealDomain={dealDomain}
			/>
		</>
	);
}
