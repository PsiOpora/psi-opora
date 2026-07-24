import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Связка диалога (messenger + userId) с контактом/сделкой Bitrix, которые
 * реально создал бот (crm.contact.add/crm.deal.add в createBitrixDeal).
 *
 * Раньше панель CRM в «Клиенты» (apps/clients) резолвила контакт только через
 * imopenlines.dialog.get → entity_data_2 — поле, которое заполняет сам
 * CRM-трекер Открытой линии при автосоздании сущностей. После того как
 * автосоздание отключили в настройках линии (см. createBitrixDeal),
 * entity_data_2 перестал заполняться, хотя бот исправно создаёт контакт и
 * сделку напрямую — панель показывала «Контакт не найден» на реально
 * существующих клиентах. Эта таблица — источник истины на стороне платформы,
 * не зависящий от настроек трекера.
 */
export const bitrixCrmLinks = pgTable(
  "bitrix_crm_links",
  {
    id: text("id").primaryKey(),
    messenger: text("messenger").notNull(),
    userId: text("user_id").notNull(),
    contactId: text("contact_id").notNull(),
    dealId: text("deal_id"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("bitrix_crm_links_dialog_idx").on(table.messenger, table.userId),
  ],
);
