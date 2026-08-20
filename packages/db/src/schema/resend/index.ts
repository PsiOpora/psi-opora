import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Единственная строка настроек — API-ключ и отправитель Resend, вводятся через /settings/email. Резервный провайдер отправки. */
export const resendSettings = pgTable("resend_settings", {
	id: text("id").primaryKey().default("singleton"),
	apiKey: text("api_key"),
	senderEmail: text("sender_email"),
	senderName: text("sender_name"),
	updatedAt: timestamp("updated_at").defaultNow(),
});
