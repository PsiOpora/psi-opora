import { z } from "zod";

export const startTelegramLoginSchema = z.object({
  lineId: z.string(),
  /** Коннектор этого конкретного слота (см. tg-personal-connector-card.tsx) —
   * передаётся Bitrix24 через PLACEMENT_OPTIONS.CONNECTOR при открытии
   * настроек канала на линии. */
  connectorId: z.string(),
  phone: z.string().min(5),
  /** api_id/api_hash приложения Telegram (my.telegram.org/apps) — вводит
   * администратор, своё приложение на каждый подключаемый номер. */
  apiId: z.coerce.number().int().positive(),
  apiHash: z.string().min(1),
});
export type StartTelegramLoginInput = z.infer<typeof startTelegramLoginSchema>;

export const submitTelegramCodeSchema = z.object({
  loginId: z.string(),
  code: z.string().min(1),
});
export type SubmitTelegramCodeInput = z.infer<typeof submitTelegramCodeSchema>;

export const submitTelegramPasswordSchema = z.object({
  loginId: z.string(),
  password: z.string().min(1),
});
export type SubmitTelegramPasswordInput = z.infer<
  typeof submitTelegramPasswordSchema
>;

export const disconnectTelegramPersonalSchema = z.object({
  lineId: z.string(),
  connectorId: z.string(),
});
export type DisconnectTelegramPersonalInput = z.infer<
  typeof disconnectTelegramPersonalSchema
>;
