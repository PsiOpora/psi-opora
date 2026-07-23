import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Метаданные диалога с клиентом для единого инбокса дашборда («Клиенты»):
 * кто ответственный менеджер и когда диалог последний раз открывали (для
 * непрочитанных). Отдельно от bot_users (снимок профиля клиента) и
 * bot_messages (сам журнал) — это состояние конкретно инбокса, а не бота.
 * id — как у bot_users: `${messenger}:${userId}`.
 * lastReadAt — один общий курсор на диалог (не персональный на менеджера),
 * как и в самой Открытой линии Bitrix24: открыл диалог — прочитано для всех.
 */
export const botConversations = pgTable(
  "bot_conversations",
  {
    id: text("id").primaryKey(),
    messenger: text("messenger").notNull(),
    userId: text("user_id").notNull(),
    assignedOperatorId: text("assigned_operator_id"),
    assignedOperatorName: text("assigned_operator_name"),
    /** Теги диалога для фильтрации в инбоксе «Клиенты» (apps/clients). */
    tags: jsonb("tags").$type<string[]>(),
    lastReadAt: timestamp("last_read_at"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("bot_conversations_messenger_idx").on(table.messenger),
  ],
);
