import { z } from "zod";
import { MESSAGE_MAX_LENGTH } from "./broadcast";

/** Пауза между сообщениями с личных номеров, секунды. Ниже — риск бана номера. */
export const OUTREACH_MIN_INTERVAL_SEC = 10;
export const OUTREACH_MAX_INTERVAL_SEC = 1800;
export const OUTREACH_MAX_DAILY_LIMIT = 2000;
export const OUTREACH_MAX_BATCH_PAUSE_MIN = 240;
export const OUTREACH_MAX_DEDUP_DAYS = 365;

export const OUTREACH_MESSENGER_CHANNELS = [
	"max",
	"telegram",
	"whatsapp",
] as const;
export type OutreachMessengerChannelInput =
	(typeof OUTREACH_MESSENGER_CHANNELS)[number];

const intervalSec = z
	.number()
	.int()
	.min(
		OUTREACH_MIN_INTERVAL_SEC,
		`Пауза — не меньше ${OUTREACH_MIN_INTERVAL_SEC} с`,
	)
	.max(
		OUTREACH_MAX_INTERVAL_SEC,
		`Пауза — не больше ${OUTREACH_MAX_INTERVAL_SEC} с`,
	);

/** Канал рассылки: личный номер и темп отправки с него. */
export const outreachChannelSchema = z
	.object({
		channel: z.enum(OUTREACH_MESSENGER_CHANNELS),
		openLineId: z.string().min(1),
		connectorId: z.string().min(1),
		minIntervalSec: intervalSec,
		maxIntervalSec: intervalSec,
		/** null — без дневного лимита. */
		dailyLimit: z
			.number()
			.int()
			.min(1)
			.max(OUTREACH_MAX_DAILY_LIMIT)
			.nullable(),
		/** null — без перерывов. */
		batchSize: z.number().int().min(1).max(1000).nullable(),
		batchPauseMin: z.number().int().min(1).max(OUTREACH_MAX_BATCH_PAUSE_MIN),
	})
	.refine((c) => c.maxIntervalSec >= c.minIntervalSec, {
		message: "Максимальная пауза меньше минимальной",
		path: ["maxIntervalSec"],
	});
export type OutreachChannelInput = z.infer<typeof outreachChannelSchema>;

/** Окно отправки по московскому времени. */
export const outreachWindowSchema = z
	.object({
		/** 1 — понедельник … 7 — воскресенье. */
		days: z
			.array(z.number().int().min(1).max(7))
			.min(1, "Выберите хотя бы один день отправки")
			.max(7),
		fromHour: z.number().int().min(0).max(23),
		toHour: z.number().int().min(1).max(24),
	})
	.refine((w) => w.toHour > w.fromHour, {
		message: "Окно отправки: время окончания раньше начала",
		path: ["toHour"],
	});
export type OutreachWindowInput = z.infer<typeof outreachWindowSchema>;

const dedupDays = z.number().int().min(1).max(OUTREACH_MAX_DEDUP_DAYS);

export const outreachPreviewSchema = z.object({
	listId: z.string().min(1),
	/** Сколько контактов отсеет «не писать повторно» — для предпросмотра. */
	dedupDays: dedupDays.nullable().optional(),
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
	/** Включённые мессенджеры в порядке приоритета; выключенных здесь нет. */
	channels: z
		.array(outreachChannelSchema)
		.max(OUTREACH_MESSENGER_CHANNELS.length)
		.refine(
			(list) => new Set(list.map((c) => c.channel)).size === list.length,
			"Канал указан дважды",
		),
	/** Исчерпан дневной лимит номера: wait — ждать следующих суток, skip — следующий канал. */
	onDailyLimit: z.enum(["wait", "skip"]),
	/** null — отправлять в любое время. */
	window: outreachWindowSchema.nullable(),
	/** Не писать тем, кому рассылка уже дошла за столько дней; null — не проверять. */
	dedupDays: dedupDays.nullable(),
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
