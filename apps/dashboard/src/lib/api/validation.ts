import { z } from "zod";

/**
 * Positive integer coercion — парсит строку в целое ≥ 1.
 * Невалидные значения (NaN, Infinity, дробные, ≤ 0) отклоняются.
 */
const positiveInt = z
	.string()
	.transform((v) => Number(v))
	.refine((n) => Number.isFinite(n) && Number.isInteger(n) && n >= 1, {
		message: "Must be a finite positive integer",
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
	return { page: parsed.page, pageSize };
}

/**
 * Валидация ISO-date строк from/to для диапазона дат.
 * Проверяет, что строка парсится в валидную Date.
 */
const isoDateString = z
	.string()
	.refine((v) => !Number.isNaN(Date.parse(v)), { message: "Invalid date" });

/** Схема range-параметров (from, to) — обе опциональны. */
export const dateRangeSchema = z.object({
	from: isoDateString.optional(),
	to: isoDateString.optional(),
});

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
