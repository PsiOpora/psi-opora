import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Журнал всех сообщений между ботами и клиентами:
 * сценарий, напоминания, отправка из вкладки CRM.
 * user_id — идентификатор клиента в мессенджере (chat id TG / user id MAX).
 */
export const botMessages = pgTable(
  "bot_messages",
  {
    id: text("id").primaryKey(),
    messenger: text("messenger").notNull(),
    userId: text("user_id").notNull(),
    /** in — от клиента, out — от бота/оператора. */
    direction: text("direction").notNull(),
    /** scenario | reminder | widget | broadcast | operator. */
    source: text("source").notNull().default("scenario"),
    text: text("text").notNull(),
    /** Bitrix-ID оператора — только для source="operator" (ответ прямо из
     * Открытой линии, см. apps/bitrix-webhook). */
    operatorId: text("operator_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("bot_messages_user_idx").on(
      table.messenger,
      table.userId,
      table.createdAt,
    ),
  ],
);
