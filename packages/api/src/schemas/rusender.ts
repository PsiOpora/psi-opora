import { z } from "zod";

/** Схема настроек Rusender (API-ключ, ID отправной точки и адрес отправителя). */
export const rusenderSettingsSchema = z.object({
  apiKey: z.string().trim().optional(),
  keyId: z.string().trim().optional(),
  senderEmail: z.string().trim().optional(),
  senderName: z.string().trim().optional(),
});

export type RusenderSettingsInput = z.infer<typeof rusenderSettingsSchema>;

export const emailProviderSchema = z.object({
  provider: z.enum(["rusender", "unisender"]),
});

export type EmailProviderInput = z.infer<typeof emailProviderSchema>;
