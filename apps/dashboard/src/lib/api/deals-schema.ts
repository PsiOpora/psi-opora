import { z } from "zod";

/**
 * Zod-схема одной сделки, как её отдаёт /api/dashboard/deals* (JSON — даты
 * строками, без ревайва в Date). Валидация ответа на клиенте — защита от
 * молчаливого расхождения формы ответа с packages/db/src/queries/deals.ts::DealRow
 * при рефакторинге API-роутов.
 */
export const DealRowSchema = z.object({
	id: z.string(),
	title: z.string(),
	stageId: z.string(),
	categoryId: z.string(),
	status: z.enum(["won", "lost", "in_progress"]),
	opportunity: z.number(),
	currency: z.string().nullable(),
	sourceId: z.string().nullable(),
	failReasonId: z.string().nullable(),
	pageUrl: z.string().nullable(),
	utmSource: z.string().nullable(),
	utmMedium: z.string().nullable(),
	utmCampaign: z.string().nullable(),
	utmContent: z.string().nullable(),
	utmTerm: z.string().nullable(),
	dateCreate: z.string(),
	closeDate: z.string().nullable(),
	dateModify: z.string(),
	syncedAt: z.string().nullable(),
});

export type DealRowDTO = z.infer<typeof DealRowSchema>;

/** Ответ /api/dashboard/deals (список с пагинацией). */
export const DealsResponseSchema = z.object({
	rows: z.array(DealRowSchema),
	total: z.number().int().nonnegative(),
	page: z.number().optional(),
	pageSize: z.number().optional(),
});

export type DealsResponseDTO = z.infer<typeof DealsResponseSchema>;
