import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Конфигурация коннектора Открытой линии официального бота (Telegram/MAX,
 * Bot API) — одна строка на мессенджер (у каждого бота ровно один
 * экземпляр, в отличие от личных номеров, см. telegram_personal_accounts).
 * Заполняется автоматически при активации канала в Контакт-центре
 * (packages/api/src/routers/bot-connector), а не через .env.
 */
export const botConnectors = pgTable("bot_connectors", {
  messenger: text("messenger").primaryKey(),
  memberId: text("member_id").notNull(),
  openLineId: text("open_line_id").notNull(),
  connectorId: text("connector_id").notNull(),
  /** Токен бота (Bot API), зашифрованный AES-256-GCM (packages/config/src/crypto.ts).
   * Вводится администратором в UI при подключении канала (см. resolveTelegramBotToken
   * в packages/bot-core/src/utils/token.ts) — без него бот не активировать. */
  botTokenEncrypted: text("bot_token_encrypted"),
  /** Момент успешной настройки вебхука Telegram/MAX API — null, если ещё
   * не настроен или последняя попытка не удалась. */
  webhookConfiguredAt: timestamp("webhook_configured_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
