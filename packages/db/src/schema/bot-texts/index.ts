import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Тексты сценария бота, редактируемые в дашборде.
 * key — идентификатор текста (см. SCENARIO_TEXT_DEFS в @psi-opora/bot-core),
 * value — переопределение; отсутствие строки означает текст по умолчанию.
 */
export const botTexts = pgTable("bot_texts", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
