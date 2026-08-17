import { z } from "zod";
import { MESSAGE_MAX_LENGTH } from "./broadcast";

const inboxMessengerSchema = z.enum([
	"telegram",
	"max",
	"telegram-personal",
	"whatsapp-personal",
	"max-personal",
]);

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

export const bitrixDialogSchema = z.object({
	dialogId: z.string().regex(/^chat\d+$/, "Некорректный ID диалога Bitrix24"),
});
export type BitrixDialogInput = z.infer<typeof bitrixDialogSchema>;

export const clientPollSchema = z.object({
	messenger: inboxMessengerSchema,
	userId: z.string(),
	sinceIso: z.string(),
});
export type ClientPollInput = z.infer<typeof clientPollSchema>;

export const sendClientMessageSchema = z.object({
	messenger: inboxMessengerSchema,
	userId: z.string(),
	/** Только для персональных каналов — на
	 * портале может быть несколько подключённых номеров, каждый на своей линии. */
	lineId: z.string().optional(),
	/** Уточняет конкретный номер, если на выбранной линии их несколько. */
	connectorId: z.string().optional(),
	text: z.string().max(MESSAGE_MAX_LENGTH),
	/** Bitrix-ID/имя оператора из b24 user.current — чтобы в истории было видно,
	 * кто из пользователей Bitrix написал ответ клиенту из инбокса «Клиенты». */
	operatorId: z.string().optional(),
	operatorName: z.string().optional(),
});
export type SendClientMessageInput = z.infer<typeof sendClientMessageSchema>;

export const editClientMessageSchema = z.object({
	messageId: z.string().min(1),
	text: z.string().trim().min(1).max(MESSAGE_MAX_LENGTH),
});
export type EditClientMessageInput = z.infer<typeof editClientMessageSchema>;

export const deleteClientMessageSchema = z.object({
	messageId: z.string().min(1),
});
export type DeleteClientMessageInput = z.infer<
	typeof deleteClientMessageSchema
>;

export const mergeClientsSchema = z.object({
	messenger: inboxMessengerSchema,
	userId: z.string(),
	intoMessenger: inboxMessengerSchema,
	intoUserId: z.string(),
	operatorId: z.string().optional(),
	operatorName: z.string().optional(),
});
export type MergeClientsInput = z.infer<typeof mergeClientsSchema>;

export const assignConversationSchema = z.object({
	messenger: inboxMessengerSchema,
	userId: z.string(),
	operatorId: z.string(),
	operatorName: z.string(),
});
export type AssignConversationInput = z.infer<typeof assignConversationSchema>;

export const setConversationTagsSchema = z.object({
	messenger: inboxMessengerSchema,
	userId: z.string(),
	tags: z.array(z.string().trim().min(1).max(40)).max(20),
});
export type SetConversationTagsInput = z.infer<
	typeof setConversationTagsSchema
>;

export const addClientNoteSchema = z.object({
	messenger: inboxMessengerSchema,
	userId: z.string(),
	text: z.string().trim().min(1).max(2000),
	operatorId: z.string().optional(),
	operatorName: z.string().optional(),
});
export type AddClientNoteInput = z.infer<typeof addClientNoteSchema>;

export const deleteClientNoteSchema = z.object({
	noteId: z.string(),
});
export type DeleteClientNoteInput = z.infer<typeof deleteClientNoteSchema>;

export const saveQuickReplySchema = z.object({
	id: z.string().optional(),
	title: z.string().trim().min(1).max(80),
	text: z.string().trim().min(1).max(MESSAGE_MAX_LENGTH),
});
export type SaveQuickReplyInput = z.infer<typeof saveQuickReplySchema>;

export const deleteQuickReplySchema = z.object({
	id: z.string(),
});
export type DeleteQuickReplyInput = z.infer<typeof deleteQuickReplySchema>;
