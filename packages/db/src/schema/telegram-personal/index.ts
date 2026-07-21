import { index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * Личные (номерные) аккаунты Telegram, подключённые как отдельный коннектор
 * Открытых линий Bitrix24 (packages/tg-userbot, mtcute) — в отличие от
 * apps/tg-bot (официальный Bot API), это реальный номер телефона, из-под
 * которого можно писать клиенту первым.
 *
 * Одна запись — один номер, привязанный к конкретной открытой линии
 * конкретного портала: один портал может подключить несколько номеров,
 * каждый на свою линию (см. imconnector.activate — один тип коннектора
 * активируется отдельно на каждой линии).
 */
export const telegramPersonalAccounts = pgTable(
  "telegram_personal_accounts",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id").notNull(),
    openLineId: text("open_line_id").notNull(),
    connectorId: text("connector_id").notNull(),
    phone: text("phone").notNull(),
    /** MTProto-сессия, зашифрованная AES-256-GCM (packages/tg-userbot/src/crypto.ts). */
    sessionEncrypted: text("session_encrypted"),
    status: text("status").notNull().default("pending_code"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("telegram_personal_accounts_member_line_idx").on(
      table.memberId,
      table.openLineId,
    ),
    index("telegram_personal_accounts_member_idx").on(table.memberId),
  ],
);
