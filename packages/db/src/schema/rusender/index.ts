import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Единственная строка настроек — API-ключ, ID отправной точки (keyId) и отправитель Rusender, вводятся через /settings/email. */
export const rusenderSettings = pgTable("rusender_settings", {
	id: text("id").primaryKey().default("singleton"),
	apiKey: text("api_key"),
	keyId: text("key_id"),
	senderEmail: text("sender_email"),
	senderName: text("sender_name"),
	/**
	 * Секрет в пути URL вебхука статусов писем: у вебхуков Rusender нет
	 * подписи, поэтому подлинность запроса подтверждает только этот секрет.
	 */
	webhookSecret: text("webhook_secret"),
	updatedAt: timestamp("updated_at").defaultNow(),
});
