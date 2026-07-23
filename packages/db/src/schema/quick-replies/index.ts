import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Быстрые ответы (шаблоны сообщений) для инбокса «Клиенты» — общие на всю
 * команду, вставляются в композер по кнопке или по «/» в начале сообщения.
 */
export const quickReplies = pgTable("quick_replies", {
  id: text("id").primaryKey(),
  /** Короткое название для списка (например, «Приветствие»). */
  title: text("title").notNull(),
  text: text("text").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
