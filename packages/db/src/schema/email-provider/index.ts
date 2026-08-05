import { pgTable, text } from "drizzle-orm/pg-core";

/** Единственная строка — какой провайдер сейчас используется для отправки email (транзакционных и CRM-рассылок). */
export const emailProviderSettings = pgTable("email_provider_settings", {
  id: text("id").primaryKey().default("singleton"),
  provider: text("provider").notNull().default("rusender"), // "rusender" | "unisender"
});
