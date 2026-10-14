import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { emailLists } from "../email-lists";

export const emailCampaigns = pgTable("email_campaigns", {
	id: text("id").primaryKey(),
	/** Откуда взяты получатели: стадия сделок CRM или собственный список. */
	audience: text("audience").notNull().default("crm_stage"), // crm_stage | list
	stageId: text("stage_id"),
	stageName: text("stage_name"),
	listId: text("list_id").references(() => emailLists.id, {
		onDelete: "set null",
	}),
	listName: text("list_name"),
	templateId: text("template_id").notNull(),
	templateName: text("template_name"),
	subject: text("subject").notNull(),
	senderEmail: text("sender_email").notNull(),
	senderName: text("sender_name"),
	provider: text("provider").notNull().default("unisender"), // unisender | rusender
	/**
	 * Публичный адрес дашборда на момент запуска — из него строятся ссылки
	 * отписки в письмах (фоновая задача не знает, на каком домене открыт дашборд).
	 */
	publicBaseUrl: text("public_base_url"),
	status: text("status").notNull(), // queued | running | done | error
	unisenderListId: text("unisender_list_id"),
	unisenderMessageId: text("unisender_message_id"),
	unisenderCampaignId: text("unisender_campaign_id"),
	totalDeals: integer("total_deals"),
	recipientsCount: integer("recipients_count"),
	sentCount: integer("sent_count"),
	openedCount: integer("opened_count"),
	clickedCount: integer("clicked_count"),
	unsubscribedCount: integer("unsubscribed_count"),
	error: text("error"),
	startedAt: timestamp("started_at").defaultNow(),
	finishedAt: timestamp("finished_at"),
});

export const emailCampaignRecipients = pgTable(
	"email_campaign_recipients",
	{
		id: text("id").primaryKey(),
		campaignId: text("campaign_id")
			.notNull()
			.references(() => emailCampaigns.id, { onDelete: "cascade" }),
		/** ID контакта CRM — только для рассылок по стадии. */
		contactId: text("contact_id"),
		contactName: text("contact_name"),
		dealId: text("deal_id"),
		dealTitle: text("deal_title"),
		email: text("email"),
		// pending | skipped | imported | sent | delivered | opened | clicked |
		// bounced | complained | unsubscribed | error
		status: text("status").notNull(),
		error: text("error"),
		/** ID письма у провайдера (uuid Rusender) — по нему сопоставляются вебхуки. */
		providerMessageId: text("provider_message_id"),
		sentAt: timestamp("sent_at"),
		deliveredAt: timestamp("delivered_at"),
		openedAt: timestamp("opened_at"),
		clickedAt: timestamp("clicked_at"),
		bouncedAt: timestamp("bounced_at"),
		complainedAt: timestamp("complained_at"),
		unsubscribedAt: timestamp("unsubscribed_at"),
		openCount: integer("open_count").notNull().default(0),
		clickCount: integer("click_count").notNull().default(0),
		lastEventAt: timestamp("last_event_at"),
		/**
		 * Счётчик для оптимистичной блокировки: вебхуки по одному письму
		 * приходят параллельно, а транзакции недоступны на драйвере neon-http.
		 */
		trackingVersion: integer("tracking_version").notNull().default(0),
	},
	(table) => [
		index("email_campaign_recipients_campaign_idx").on(table.campaignId),
		index("email_campaign_recipients_campaign_email_idx").on(
			table.campaignId,
			table.email,
		),
		index("email_campaign_recipients_provider_message_idx").on(
			table.providerMessageId,
		),
	],
);
