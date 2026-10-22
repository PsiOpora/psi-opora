import {
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { emailCampaigns } from "../email-campaign";
import { emailLists } from "../email-lists";

/** Канал мультиканальной рассылки; порядок мессенджеров задаётся при запуске, email — всегда последний. */
export type OutreachChannel = "max" | "telegram" | "whatsapp" | "email";
export type OutreachMessengerChannel = Exclude<OutreachChannel, "email">;

/** Личный номер, выбранный для канала при запуске (null — канал выключен). */
export interface OutreachAccountRef {
	openLineId: string;
	connectorId: string;
	/** Номер аккаунта — только для подписи в отчёте. */
	phone: string;
}

export interface OutreachAccounts {
	max: OutreachAccountRef | null;
	telegram: OutreachAccountRef | null;
	whatsapp: OutreachAccountRef | null;
}

/** Одна попытка доставки по каналу — из них складывается история «почему ушло сюда». */
export interface OutreachAttempt {
	channel: OutreachChannel;
	ok: boolean;
	error?: string;
	/**
	 * Канал не пробовали — у номера исчерпан дневной лимит. Такие записи не
	 * считаются отправками при подсчёте лимитов.
	 */
	skipped?: boolean;
	/** ISO-время попытки. */
	at: string;
}

/** Темп отправки с одного личного номера — банят именно номер, поэтому настройки поканальные. */
export interface OutreachChannelPacing {
	channel: OutreachMessengerChannel;
	/** Случайная пауза между сообщениями с этого номера, секунды. */
	minIntervalSec: number;
	maxIntervalSec: number;
	/** Не больше стольких сообщений с номера за сутки (МСК), по всем рассылкам; null — без лимита. */
	dailyLimit: number | null;
	/** Перерыв после каждых batchSize сообщений; null — без перерывов. */
	batchSize: number | null;
	batchPauseMin: number;
}

/** Окно отправки по московскому времени: дни недели (1 — пн … 7 — вс) и часы [fromHour, toHour). */
export interface OutreachSendWindow {
	days: number[];
	fromHour: number;
	toHour: number;
}

export interface OutreachSettings {
	/** Включённые мессенджеры в порядке приоритета. */
	channels: OutreachChannelPacing[];
	/** wait — ждать следующих суток; skip — пропускать канал и идти дальше по цепочке. */
	onDailyLimit: "wait" | "skip";
	window: OutreachSendWindow | null;
	/** Не писать тем, кому рассылка уже дошла за столько дней; null — не проверять. */
	dedupDays: number | null;
}

/**
 * Рассылка по списку контактов через личные номера с каскадом каналов в
 * заданном порядке (по умолчанию MAX → Telegram → WhatsApp), а кому не
 * удалось написать ни в один мессенджер — письмо (через обычную
 * email-кампанию, см. emailCampaignId).
 */
export const outreachCampaigns = pgTable("outreach_campaigns", {
	id: text("id").primaryKey(),
	listId: text("list_id").references(() => emailLists.id, {
		onDelete: "set null",
	}),
	listName: text("list_name"),
	/** Портал Bitrix24 — личные номера принадлежат ему (memberId в *_personal_accounts). */
	memberId: text("member_id").notNull(),
	message: text("message").notNull(),
	accounts: jsonb("accounts").$type<OutreachAccounts>().notNull(),
	/**
	 * Порядок каналов, темп и ограничения. null — рассылка создана до
	 * появления настроек: порядок MAX → Telegram → WhatsApp, пауза intervalSec ±25%.
	 */
	settings: jsonb("settings").$type<OutreachSettings>(),
	/** Пауза между отправками (у новых рассылок — минимальная пауза первого канала). */
	intervalSec: integer("interval_sec").notNull(),
	/** Email-фолбэк: шаблон и тема письма. null — письма не отправляются. */
	emailTemplateId: text("email_template_id"),
	emailTemplateName: text("email_template_name"),
	emailSubject: text("email_subject"),
	emailSenderEmail: text("email_sender_email"),
	emailSenderName: text("email_sender_name"),
	emailProvider: text("email_provider"), // unisender | rusender | postbox
	publicBaseUrl: text("public_base_url"),
	/** Email-кампания, созданная для тех, до кого не дошло ни одно сообщение. */
	emailCampaignId: text("email_campaign_id").references(
		() => emailCampaigns.id,
		{ onDelete: "set null" },
	),
	status: text("status").notNull(), // queued | running | done | error | cancelled
	/** Рассылка ждёт (окно отправки, лимит, перерыв) — до этого времени и почему. */
	resumeAt: timestamp("resume_at"),
	pauseReason: text("pause_reason"),
	recipientsCount: integer("recipients_count").notNull().default(0),
	error: text("error"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	startedAt: timestamp("started_at"),
	finishedAt: timestamp("finished_at"),
});

export const outreachRecipients = pgTable(
	"outreach_recipients",
	{
		id: text("id").primaryKey(),
		campaignId: text("campaign_id")
			.notNull()
			.references(() => outreachCampaigns.id, { onDelete: "cascade" }),
		/** Контакт списка на момент запуска (сам контакт могут удалить позже). */
		listContactId: text("list_contact_id"),
		name: text("name"),
		phone: text("phone"),
		email: text("email"),
		// pending | sending | sent | email | failed | skipped | unknown
		// sending — попытка в процессе; unknown — воркер личного номера мог
		// отправить, но не подтвердил: каскад остановлен, чтобы не задублить.
		status: text("status").notNull(),
		/** Канал, через который сообщение ушло (или email — передано в почту). */
		channel: text("channel").$type<OutreachChannel>(),
		attempts: jsonb("attempts")
			.$type<OutreachAttempt[]>()
			.notNull()
			.default([]),
		/** ID сообщения в мессенджере (для поиска в журнале bot_messages). */
		externalId: text("external_id"),
		/** Получатель созданной email-кампании — его статус (открыл/отписался) смотрим там. */
		emailRecipientId: text("email_recipient_id"),
		error: text("error"),
		sentAt: timestamp("sent_at"),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [
		index("outreach_recipients_campaign_status_idx").on(
			table.campaignId,
			table.status,
		),
		index("outreach_recipients_phone_idx").on(table.phone),
		index("outreach_recipients_email_idx").on(table.email),
	],
);
