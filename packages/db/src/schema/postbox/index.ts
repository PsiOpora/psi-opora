import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Единственная строка настроек — статический ключ доступа (keyId + секрет в apiKey) и отправитель Yandex Postbox, вводятся через /settings/email. Резервный провайдер отправки. */
export const postboxSettings = pgTable("postbox_settings", {
	id: text("id").primaryKey().default("singleton"),
	apiKey: text("api_key"),
	keyId: text("key_id"),
	senderEmail: text("sender_email"),
	senderName: text("sender_name"),
	updatedAt: timestamp("updated_at").defaultNow(),
});
