import { z } from "zod";
import { MESSAGE_MAX_LENGTH, sendWidgetMessageSchema } from "./broadcast";
import {
	clientThreadSchema,
	inboxMessengerSchema,
	messageAttachmentSchema,
} from "./messages";

/** Дальше этого срока откладывать нельзя — защита от опечатки в годе. */
export const SCHEDULE_MAX_AHEAD_DAYS = 365;
/** Ближе этого — смысла откладывать нет (крон срабатывает раз в минуту), а
 * небольшой запас прощает расхождение часов браузера и сервера. */
export const SCHEDULE_MIN_AHEAD_SECONDS = 30;

const sendAtSchema = z.iso.datetime({
	message: "Некорректные дата и время отправки",
});

export const scheduleClientMessageSchema = z
	.object({
		messenger: inboxMessengerSchema,
		userId: z.string(),
		lineId: z.string().optional(),
		connectorId: z.string().optional(),
		text: z.string().max(MESSAGE_MAX_LENGTH),
		attachment: messageAttachmentSchema.optional(),
		operatorName: z.string().optional(),
		sendAt: sendAtSchema,
	})
	.refine((input) => input.text.trim() || input.attachment, {
		message: "Введите текст сообщения или прикрепите файл",
		path: ["text"],
	});
export type ScheduleClientMessageInput = z.infer<
	typeof scheduleClientMessageSchema
>;

export const scheduleWidgetMessageSchema = sendWidgetMessageSchema.extend({
	sendAt: sendAtSchema,
});
export type ScheduleWidgetMessageInput = z.infer<
	typeof scheduleWidgetMessageSchema
>;

export const listScheduledClientMessagesSchema = clientThreadSchema;

export const listScheduledWidgetMessagesSchema = z.object({
	entity: z.enum(["deal", "contact"]),
	entityId: z.string(),
});

export const cancelScheduledMessageSchema = z.object({
	id: z.string().min(1),
});
