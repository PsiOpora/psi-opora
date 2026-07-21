import { z } from "zod";

export const startTelegramLoginSchema = z.object({
  lineId: z.string(),
  phone: z.string().min(5),
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
});
export type DisconnectTelegramPersonalInput = z.infer<
  typeof disconnectTelegramPersonalSchema
>;
