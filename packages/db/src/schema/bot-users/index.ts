import { boolean, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Профиль клиента, обратившегося к боту, — снимок данных из API мессенджера
 * (Telegram getChat / MAX getChatMembers) плюс то, что приходит в каждом апдейте.
 * userId — идентификатор пользователя в мессенджере (не chat id).
 */
export const botUsers = pgTable(
  "bot_users",
  {
    id: text("id").primaryKey(),
    messenger: text("messenger").notNull(),
    userId: text("user_id").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    /** Отображаемое имя целиком (для MAX, где имя одним полем). */
    name: text("name"),
    username: text("username"),
    languageCode: text("language_code"),
    isPremium: boolean("is_premium"),
    isBot: boolean("is_bot"),
    bio: text("bio"),
    /** Публичный URL аватара (MAX). Для Telegram URL содержит токен бота — не сохраняем, только file_id. */
    avatarUrl: text("avatar_url"),
    /** big_file_id фото профиля в Telegram — для получения ссылки нужен отдельный getFile с токеном бота. */
    photoFileId: text("photo_file_id"),
    /** UTM источник/кампания первого обращения. */
    source: text("source"),
    campaign: text("campaign"),
    /** Сырой ответ API (getChat/getChatMembers) — на случай полей, которые ещё не завели колонкой. */
    rawProfile: jsonb("raw_profile"),
    firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("bot_users_messenger_idx").on(table.messenger)],
);
