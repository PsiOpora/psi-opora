import { z } from "zod";

/**
 * Лимит start-параметра Telegram — 64 символа: 24 (код) + «_» + 39 (площадка).
 *
 * Кодовое слово кампании: латиница, цифры, «-» — без «_», потому что
 * подчёркивание отделяет площадку в ссылке (FREE_vk).
 */
const codeSchema = z
	.string()
	.trim()
	.regex(
		/^[A-Za-z0-9-]{1,24}$/,
		"Кодовое слово: латиница, цифры и «-», без «_» и пробелов, до 24 символов",
	);

/** Код площадки в ссылке: может содержать «_» (tg_ads), делим по первому «_» кода кампании. */
const sourceSchema = z
	.string()
	.trim()
	.regex(
		/^[A-Za-z0-9_-]{1,39}$/,
		"Код площадки: латиница, цифры, «_» и «-», до 39 символов",
	);

export const marketingCampaignInputSchema = z.object({
	code: codeSchema,
	title: z.string().trim().min(1, "Укажите название кампании").max(200),
	sources: z.array(sourceSchema).max(30),
	active: z.boolean().optional(),
});

export const createMarketingCampaignSchema = marketingCampaignInputSchema;

export const updateMarketingCampaignSchema = marketingCampaignInputSchema
	.partial()
	.extend({ id: z.string() });

export const marketingCampaignIdSchema = z.object({ id: z.string() });

export type MarketingCampaignInput = z.infer<
	typeof marketingCampaignInputSchema
>;
