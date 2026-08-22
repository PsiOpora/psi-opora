import {
	Pagination,
	PaginationContent,
	PaginationEllipsis,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
} from "@/components/ui/pagination";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { formatNumber } from "@/lib/format";

export const PAGE_SIZE_OPTIONS = [20, 50, 100];

/** Номера страниц с многоточиями вокруг текущей — вместо сплошного списка
 * из сотен кнопок при большом количестве страниц. */
function buildPageItems(
	pageIndex: number,
	pageCount: number,
): Array<number | "ellipsis"> {
	const current = pageIndex + 1;
	const items = new Set<number>([
		1,
		pageCount,
		current - 1,
		current,
		current + 1,
	]);
	const sorted = [...items]
		.filter((p) => p >= 1 && p <= pageCount)
		.sort((a, b) => a - b);

	const result: Array<number | "ellipsis"> = [];
	let prev: number | undefined;
	for (const page of sorted) {
		if (prev !== undefined && page - prev > 1) result.push("ellipsis");
		result.push(page);
		prev = page;
	}
	return result;
}

interface DealsTablePaginationProps {
	pageIndex: number;
	pageCount: number;
	pageSize: number;
	from: number;
	to: number;
	total: number;
	canPreviousPage: boolean;
	canNextPage: boolean;
	onPageChange: (pageIndex: number) => void;
	onPageSizeChange: (pageSize: number) => void;
}

export function DealsTablePagination({
	pageIndex,
	pageCount,
	pageSize,
	from,
	to,
	total,
	canPreviousPage,
	canNextPage,
	onPageChange,
	onPageSizeChange,
}: DealsTablePaginationProps) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
			<div className="flex items-center gap-3">
				<span>
					{formatNumber(from)}–{formatNumber(to)} из {formatNumber(total)}
				</span>
				<Select
					value={String(pageSize)}
					onValueChange={(value) => onPageSizeChange(Number(value))}
				>
					<SelectTrigger
						aria-label="Строк на странице"
						size="sm"
						className="w-auto"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							{PAGE_SIZE_OPTIONS.map((size) => (
								<SelectItem key={size} value={String(size)}>
									{size} на странице
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>
			</div>
			<Pagination className="mx-0 w-auto">
				<PaginationContent>
					<PaginationItem>
						<PaginationPrevious
							href="#"
							text=""
							aria-disabled={!canPreviousPage}
							tabIndex={canPreviousPage ? undefined : -1}
							className={
								canPreviousPage ? undefined : "pointer-events-none opacity-50"
							}
							onClick={(event) => {
								event.preventDefault();
								if (canPreviousPage) {
									onPageChange(pageIndex - 1);
								}
							}}
						/>
					</PaginationItem>
					{buildPageItems(pageIndex, pageCount).map((item, index) =>
						item === "ellipsis" ? (
							// biome-ignore lint/suspicious/noArrayIndexKey: ellipsis positions are stable within a single render
							<PaginationItem key={`ellipsis-${index}`}>
								<PaginationEllipsis />
							</PaginationItem>
						) : (
							<PaginationItem key={item}>
								<PaginationLink
									href="#"
									isActive={item === pageIndex + 1}
									onClick={(event) => {
										event.preventDefault();
										onPageChange(item - 1);
									}}
								>
									{item}
								</PaginationLink>
							</PaginationItem>
						),
					)}
					<PaginationItem>
						<PaginationNext
							href="#"
							text=""
							aria-disabled={!canNextPage}
							tabIndex={canNextPage ? undefined : -1}
							className={
								canNextPage ? undefined : "pointer-events-none opacity-50"
							}
							onClick={(event) => {
								event.preventDefault();
								if (canNextPage) {
									onPageChange(pageIndex + 1);
								}
							}}
						/>
					</PaginationItem>
				</PaginationContent>
			</Pagination>
		</div>
	);
}
