import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { botGuideCampaigns } from "../bot-guide-campaigns";

/**
 * Факт выдачи материала по кампании конкретному пользователю —
 * используется cron-джобой follow-up-напоминаний (через N дней после
 * deliveredAt) и хранит снимок контактов, чтобы не зависеть от Redis-сессии
 * сценария, которая к моменту напоминания уже истекла.
 * id = `${messenger}:${userId}:${campaignId}` — одна выдача на пользователя
 * в рамках кампании.
 */
export const botGuideDeliveries = pgTable("bot_guide_deliveries", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id")
    .notNull()
    .references(() => botGuideCampaigns.id),
  messenger: text("messenger").notNull(),
  userId: text("user_id").notNull(),
  /** Внешний ID чата (imconnector.send.messages) — для сделки/уведомления менеджера. */
  chatId: text("chat_id"),
  dealId: integer("deal_id"),
  name: text("name"),
  phone: text("phone"),
  email: text("email"),
  deliveredAt: timestamp("delivered_at").defaultNow().notNull(),
  followUpSentAt: timestamp("follow_up_sent_at"),
  diagnosticRequestedAt: timestamp("diagnostic_requested_at"),
});
