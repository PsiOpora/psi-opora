import { z } from "zod";
import { MESSAGE_MAX_LENGTH } from "./broadcast";

/** Пауза между сообщениями с личных номеров, секунды. Ниже — риск бана номера. */
export const OUTREACH_MIN_INTERVAL_SEC = 10;
export const OUTREACH_DEFAULT_INTERVAL_SEC = 30;
export const OUTREACH_MAX_INTERVAL_SEC = 600;

const accountRefSchema = z
	.object({
		openLineId: z.string().min(1),
		connectorId: z.string().min(1),
	})
	.nullable();

export const outreachPreviewSchema = z.object({
	listId: z.string().min(1),
});

export const sendOutreachSchema = z.object({
	listId: z.string().min(1),
	message: z
		.string()
		.trim()
		.min(1, "Введите текст сообщения")
		.max(
			MESSAGE_MAX_LENGTH,
			`Сообщение длиннее ${MESSAGE_MAX_LENGTH} символов`,
		),
	/** Личный номер для каждого канала; null — канал не используется. */
	accounts: z.object({
		max: accountRefSchema,
		telegram: accountRefSchema,
		whatsapp: accountRefSchema,
	}),
	intervalSec: z
		.number()
		.int()
		.min(OUTREACH_MIN_INTERVAL_SEC)
		.max(OUTREACH_MAX_INTERVAL_SEC),
	/** Email-фолбэк для тех, до кого не дошло ни одно сообщение; null — выключен. */
	email: z
		.object({
			templateId: z.string().min(1, "Выберите шаблон письма"),
			templateName: z.string().optional(),
			subject: z.string().trim().min(1, "Введите тему письма").max(300),
		})
		.nullable(),
	/** Число контактов из предпросмотра — защита от отправки по изменившемуся списку. */
	expectedRecipients: z.number().int().min(0),
});
export type SendOutreachInput = z.infer<typeof sendOutreachSchema>;

export const outreachIdSchema = z.object({ id: z.string().min(1) });

export const OUTREACH_RECIPIENT_FILTER_VALUES = [
	"all",
	"max",
	"telegram",
	"whatsapp",
	"email",
	"failed",
	"unknown",
	"pending",
	"skipped",
] as const;

export const outreachRecipientsQuerySchema = z.object({
	id: z.string().min(1),
	filter: z.enum(OUTREACH_RECIPIENT_FILTER_VALUES).default("all"),
	search: z.string().max(200).optional(),
	page: z.number().int().min(0).default(0),
	pageSize: z.number().int().min(1).max(200).default(50),
});
