import { z } from "zod";

export const botMessengerSchema = z.enum(["telegram", "max"]);

export const activateBotConnectorSchema = z.object({
  messenger: botMessengerSchema,
  lineId: z.string(),
  botToken: z.string().min(1).optional(),
});
export type ActivateBotConnectorInput = z.infer<
  typeof activateBotConnectorSchema
>;

export const deactivateBotConnectorSchema = z.object({
  messenger: botMessengerSchema,
});
export type DeactivateBotConnectorInput = z.infer<
  typeof deactivateBotConnectorSchema
>;
