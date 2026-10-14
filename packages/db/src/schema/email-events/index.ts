import {
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Журнал событий доставки писем рассылок (вебхуки Rusender/Unisender и
 * собственная страница отписки). Из него строится история по конкретному
 * получателю; агрегированный статус получателя хранится в
 * email_campaign_recipients и пересчитывается при каждом событии.
 */
export const emailEvents = pgTable(
	"email_events",
	{
		id: text("id").primaryKey(),
		provider: text("provider").notNull(), // rusender | unisender | internal
		/**
		 * Идентификатор события у провайдера — для дедупликации: оба провайдера
		 * гарантируют доставку вебхука «как минимум один раз».
		 */
		externalId: text("external_id").notNull(),
		campaignId: text("campaign_id"),
		recipientId: text("recipient_id"),
		email: text("email"),
		// sent | delivered | opened | clicked | soft_bounced | bounced |
		// complained | unsubscribed | failed
		type: text("type").notNull(),
		occurredAt: timestamp("occurred_at").notNull(),
		details: text("details"),
		payload: jsonb("payload"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("email_events_provider_external_idx").on(
			table.provider,
			table.externalId,
		),
		index("email_events_recipient_idx").on(table.recipientId),
	],
);
