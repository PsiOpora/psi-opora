import { z } from "zod";

/** Схема настроек Resend (API-ключ и адрес отправителя). Резервный провайдер отправки. */
export const resendSettingsSchema = z.object({
  apiKey: z.string().trim().optional(),
  senderEmail: z.string().trim().optional(),
  senderName: z.string().trim().optional(),
});

export type ResendSettingsInput = z.infer<typeof resendSettingsSchema>;
