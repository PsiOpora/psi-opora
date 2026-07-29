import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

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
    /** big_file_id фото профиля в Telegram — для получения ссылки нужен отдельный getFile с токеном бота. */
    photoFileId: text("photo_file_id"),
    /** Ключ объекта в S3 (bot/avatar/…), если аватар скачан и перезалит в наше хранилище. */
    avatarS3Key: text("avatar_s3_key"),
    /** UTM источник/кампания первого обращения. */
    source: text("source"),
    campaign: text("campaign"),
    /** Сырой ответ API (getChat/getChatMembers) — на случай полей, которые ещё не завели колонкой. */
    rawProfile: jsonb("raw_profile"),
    firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
    /** Последний статус присутствия, который вернул сам мессенджер.
     * Telegram: online/offline/recently/within_week/within_month/long_time_ago.
     * WhatsApp: online/offline/typing/recording/paused. */
    presenceStatus: text("presence_status"),
    /** Точное messenger last seen, только когда его раскрывают настройки
     * приватности клиента. Не заменяется приблизительным временем. */
    messengerLastSeenAt: timestamp("messenger_last_seen_at"),
    /** Когда мы в последний раз получили presence от API мессенджера. */
    presenceObservedAt: timestamp("presence_observed_at"),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("bot_users_messenger_idx").on(table.messenger)],
);
