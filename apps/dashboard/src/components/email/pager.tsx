"use client";

import { Button } from "@/components/ui/button";

/** Постраничная навигация для таблиц с серверной пагинацией. */
export function Pager({
	page,
	pageSize,
	total,
	onPageChange,
}: {
	page: number;
	pageSize: number;
	total: number;
	onPageChange: (page: number) => void;
}) {
	if (total <= pageSize) return null;
	const pageCount = Math.max(1, Math.ceil(total / pageSize));
	return (
		<div className="flex items-center justify-between gap-4 pt-3 text-sm text-muted-foreground">
			<span className="tabular-nums">
				{page * pageSize + 1}–{Math.min(total, (page + 1) * pageSize)} из{" "}
				{total.toLocaleString("ru-RU")}
			</span>
			<div className="flex items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					onClick={() => onPageChange(Math.max(0, page - 1))}
					disabled={page === 0}
				>
					Назад
				</Button>
				<span className="tabular-nums">
					{page + 1} / {pageCount}
				</span>
				<Button
					variant="outline"
					size="sm"
					onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
					disabled={page >= pageCount - 1}
				>
					Вперёд
				</Button>
			</div>
		</div>
	);
}
