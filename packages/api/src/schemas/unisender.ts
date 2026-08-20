import { z } from "zod";

/** Схема настроек Unisender (API-ключ и адрес отправителя рассылки). */
export const unisenderSettingsSchema = z.object({
	apiKey: z.string().trim().optional(),
	senderEmail: z.string().trim().optional(),
	senderName: z.string().trim().optional(),
});

export type UnisenderSettingsInput = z.infer<typeof unisenderSettingsSchema>;
