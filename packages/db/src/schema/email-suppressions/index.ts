import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Глобальный стоп-лист email: адреса, которым нельзя слать рассылки —
 * отписались, жёсткий отказ доставки (hard bounce), жалоба на спам или
 * добавлены вручную. Учитывается всеми email-рассылками (по спискам и по
 * стадиям CRM); повторная отправка таким адресам портит репутацию домена.
 */
export const emailSuppressions = pgTable("email_suppressions", {
	/** Нормализованный (trim + lower case) адрес. */
	email: text("email").primaryKey(),
	reason: text("reason").notNull(), // unsubscribed | bounced | complained | manual
	/** Рассылка, из-за которой адрес попал в стоп-лист (если известна). */
	campaignId: text("campaign_id"),
	details: text("details"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
});
