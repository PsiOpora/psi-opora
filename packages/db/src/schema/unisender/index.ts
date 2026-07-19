import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Единственная строка настроек — API-ключ и отправитель Unisender, вводятся через /settings/email. */
export const unisenderSettings = pgTable("unisender_settings", {
  id: text("id").primaryKey().default("singleton"),
  apiKey: text("api_key"),
  senderEmail: text("sender_email"),
  senderName: text("sender_name"),
  updatedAt: timestamp("updated_at").defaultNow(),
});
