import { z } from "zod";

export const guideCampaignIdSchema = z.object({ id: z.string() });

/** Кто открывал материал кампании: без campaignId — по всем кампаниям. */
export const guideViewersSchema = z.object({
  campaignId: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export const guideCampaignInputSchema = z.object({
  keyword: z.string().trim().min(1, "Укажите кодовое слово"),
  title: z.string().trim().min(1, "Укажите тему материала"),
  guideId: z.string().nullable().optional(),
  welcomeMessage: z.string().trim().nullable().optional(),
  emailQuestion: z.string().trim().min(1, "Укажите вопрос перед сбором email"),
  emailSubject: z.string().trim().min(1, "Укажите тему письма"),
  emailBody: z.string().trim().min(1, "Укажите текст письма"),
  deliveryMessage: z
    .string()
    .trim()
    .min(1, "Укажите сообщение при выдаче гайда"),
  followUpDelayDays: z.number().int().min(1).max(30),
  followUpMessage: z
    .string()
    .trim()
    .min(1, "Укажите текст follow-up-сообщения"),
  diagnosticCtaText: z.string().trim().min(1).optional(),
  active: z.boolean().optional(),
});

export const createGuideCampaignSchema = guideCampaignInputSchema;

export const updateGuideCampaignSchema = guideCampaignInputSchema
  .partial()
  .extend({ id: z.string() });

export type GuideCampaignInput = z.infer<typeof guideCampaignInputSchema>;
