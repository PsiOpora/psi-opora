import { z } from "zod";

/**
 * Positive integer coercion — парсит строку в целое ≥ 1.
 * Невалидные значения (NaN, Infinity, дробные, ≤ 0, небезопасные) отклоняются.
 */
const positiveInt = z
	.string()
	.transform((v) => Number(v))
	.refine((n) => Number.isSafeInteger(n) && n >= 1, {
		message: "Must be a safe positive integer",
	});

/** Pagination params (page & pageSize) с дефолтами и потолком. */
export const paginationSchema = z.object({
	page: positiveInt.optional().default(1),
	pageSize: positiveInt.optional().default(50),
});

/**
 * Парсит и валидирует пагинационные параметры из URLSearchParams.
 * Возвращает безопасные page/pageSize или бросает ZodError.
 */
export function parsePagination(
	params: URLSearchParams,
	opts: { defaultPageSize?: number; maxPageSize?: number } = {},
): { page: number; pageSize: number } {
	const { defaultPageSize = 50, maxPageSize = 200 } = opts;

	const rawPage = params.get("page") ?? "1";
	const rawPageSize = params.get("pageSize") ?? String(defaultPageSize);

	const parsed = z
		.object({
			page: positiveInt,
			pageSize: positiveInt,
		})
		.parse({ page: rawPage, pageSize: rawPageSize });

	const pageSize = Math.min(parsed.pageSize, maxPageSize);

	// Validate that page offset calculation stays within safe integer range
	const offset = (parsed.page - 1) * pageSize;
	if (!Number.isSafeInteger(offset)) {
		throw new z.ZodError([
			{
				code: "custom",
				path: ["page"],
				message: "Page offset exceeds safe integer range",
			},
		]);
	}

	return { page: parsed.page, pageSize };
}

/**
 * Валидация ISO-date строк from/to для диапазона дат.
 * Требует точный формат YYYY-MM-DD и валидирует, что компоненты календаря
 * совпадают с входом (отклоняет несуществующие даты вроде 31 февраля).
 */
const isoDateString = z
	.string()
	.refine(
		(v) => {
			const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
			if (!match) return false;
			const [, year, month, day] = match;
			const parsed = new Date(v);
			if (Number.isNaN(parsed.getTime())) return false;
			// Verify calendar components match input (rejects nonexistent dates)
			return (
				parsed.getFullYear() === Number(year) &&
				parsed.getMonth() + 1 === Number(month) &&
				parsed.getDate() === Number(day)
			);
		},
		{ message: "Must be a valid date in YYYY-MM-DD format" },
	);

/** Схема range-параметров (from, to) — обе опциональны, with cross-field validation. */
export const dateRangeSchema = z
	.object({
		from: isoDateString.optional(),
		to: isoDateString.optional(),
	})
	.refine(
		(data) => {
			if (!data.from || !data.to) return true;
			return new Date(data.from) <= new Date(data.to);
		},
		{ message: "'from' must not be later than 'to'" },
	);

/**
 * Валидация параметра previous (должен быть "1" или отсутствовать).
 */
export const previousSchema = z.object({
	previous: z.enum(["1", "0"]).optional(),
});

/**
 * Объединённая схема для summary-эндпоинта: range + previous.
 */
export const summaryParamsSchema = dateRangeSchema.merge(previousSchema);

/**
 * Парсит и валидирует date-range параметры из URLSearchParams.
 * Бросает ZodError при невалидных from/to.
 */
export function validateDateRange(params: URLSearchParams): void {
	const from = params.get("from");
	const to = params.get("to");
	dateRangeSchema.parse({
		from: from ?? undefined,
		to: to ?? undefined,
	});
}

/**
 * Общий обработчик: обернуть валидацию и вернуть 400 при ZodError.
 */
export function zodBadRequest(error: unknown): Response | null {
	if (error instanceof z.ZodError) {
		return Response.json(
			{ error: "Invalid parameters", details: error.issues },
			{ status: 400 },
		);
	}
	return null;
}
