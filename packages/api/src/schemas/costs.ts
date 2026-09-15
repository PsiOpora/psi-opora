import { z } from "zod";

/** Схема добавления записи расхода на маркетинговый канал (форма /costs). */
export const addCostSchema = z.object({
	month: z
		.string()
		.trim()
		.regex(/^\d{4}-\d{2}$/, "Укажите месяц"),
	utmSource: z.string().trim().min(1, "Укажите UTM source"),
	utmCampaign: z.string().trim().default(""),
	amount: z.number().positive("Сумма должна быть больше нуля"),
	note: z.string().trim().default(""),
});

export type AddCostInput = z.input<typeof addCostSchema>;
