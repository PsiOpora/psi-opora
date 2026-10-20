import { z } from "zod";

/** Схема настроек Yandex Postbox (статический ключ: ID + секрет в apiKey, и адрес отправителя). Резервный провайдер отправки. */
export const postboxSettingsSchema = z.object({
	apiKey: z.string().trim().optional(),
	keyId: z.string().trim().optional(),
	senderEmail: z.string().trim().optional(),
	senderName: z.string().trim().optional(),
});

export type PostboxSettingsInput = z.infer<typeof postboxSettingsSchema>;
