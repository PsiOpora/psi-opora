import { z } from "zod";
import { MESSAGE_MAX_LENGTH } from "./broadcast";

const inboxMessengerSchema = z.enum(["telegram", "max", "telegram-personal"]);

export const listClientsSchema = z.object({
  search: z.string().optional(),
  limit: z.number().min(1).max(100).optional(),
  offset: z.number().min(0).optional(),
});
export type ListClientsInput = z.infer<typeof listClientsSchema>;

export const clientThreadSchema = z.object({
  messenger: inboxMessengerSchema,
  userId: z.string(),
});
export type ClientThreadInput = z.infer<typeof clientThreadSchema>;

export const clientPollSchema = z.object({
  messenger: inboxMessengerSchema,
  userId: z.string(),
  sinceIso: z.string(),
});
export type ClientPollInput = z.infer<typeof clientPollSchema>;

export const sendClientMessageSchema = z.object({
  messenger: inboxMessengerSchema,
  userId: z.string(),
  /** Только для messenger="telegram-personal" — на портале может быть
   * несколько подключённых номеров, каждый на своей линии. */
  lineId: z.string().optional(),
  text: z.string().max(MESSAGE_MAX_LENGTH),
});
export type SendClientMessageInput = z.infer<typeof sendClientMessageSchema>;

export const assignConversationSchema = z.object({
  messenger: inboxMessengerSchema,
  userId: z.string(),
  operatorId: z.string(),
  operatorName: z.string(),
});
export type AssignConversationInput = z.infer<typeof assignConversationSchema>;
