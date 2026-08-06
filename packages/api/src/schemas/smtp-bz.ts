import { z } from "zod";

/** Схема настроек SMTP.BZ (API-ключ и адрес отправителя). Резервный провайдер отправки. */
export const smtpBzSettingsSchema = z.object({
  apiKey: z.string().trim().optional(),
  senderEmail: z.string().trim().optional(),
  senderName: z.string().trim().optional(),
});

export type SmtpBzSettingsInput = z.infer<typeof smtpBzSettingsSchema>;
