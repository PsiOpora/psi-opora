import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Учёт купленных пакетов/курсов и оплат Т-Банка (apps/payments).
 * Все суммы — в копейках (целые), как в API Т-Банка: рубли в Bitrix
 * получаются делением на 100 только на границе записи в CRM.
 */

/** Каталог: пакет консультаций или курс. */
export const paymentProducts = pgTable("payment_products", {
	id: text("id").primaryKey(),
	kind: text("kind", { enum: ["package", "course"] }).notNull(),
	name: text("name").notNull(),
	priceKopecks: integer("price_kopecks").notNull(),
	/** Для пакетов — сколько сессий входит; для курсов null. */
	sessionsCount: integer("sessions_count"),
	/** Срок действия пакета/доступа к курсу в днях; null — бессрочно. */
	validDays: integer("valid_days"),
	active: boolean("active").notNull().default(true),
	createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Покупка клиента: «кто, что и когда купил». Создаётся до оплаты
 * (pending) — её id идёт в OrderId платежа эквайринга, поэтому оплата
 * находит покупку без догадок. paid — когда оплачено не меньше цены.
 */
export const purchases = pgTable(
	"purchases",
	{
		id: text("id").primaryKey(),
		/** Контакт Bitrix24 — ключ клиента для итоговой суммы. */
		contactId: text("contact_id").notNull(),
		dealId: text("deal_id"),
		productId: text("product_id"),
		/** Снимок названия и цены на момент покупки — каталог может меняться. */
		title: text("title").notNull(),
		kind: text("kind", { enum: ["package", "course"] }).notNull(),
		amountKopecks: integer("amount_kopecks").notNull(),
		sessionsTotal: integer("sessions_total"),
		sessionsUsed: integer("sessions_used").notNull().default(0),
		status: text("status", {
			enum: ["pending", "paid", "refunded", "cancelled"],
		})
			.notNull()
			.default("pending"),
		paidAt: timestamp("paid_at"),
		expiresAt: timestamp("expires_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [
		index("purchases_contact_idx").on(table.contactId, table.createdAt),
		index("purchases_deal_idx").on(table.dealId),
		index("purchases_status_idx").on(table.status),
	],
);

/**
 * Оплата, пришедшая из Т-Банка. external_id уникален в рамках источника —
 * по нему повторные уведомления (банк шлёт ретраи и дубли) безопасно
 * игнорируются. match_status=unmatched — очередь ручного разбора.
 */
export const payments = pgTable(
	"payments",
	{
		id: text("id").primaryKey(),
		source: text("source", {
			enum: ["tbank_acquiring", "tbank_account"],
		}).notNull(),
		externalId: text("external_id").notNull(),
		amountKopecks: integer("amount_kopecks").notNull(),
		status: text("status", { enum: ["paid", "refunded"] })
			.notNull()
			.default("paid"),
		paidAt: timestamp("paid_at").notNull(),
		payerName: text("payer_name"),
		payerInn: text("payer_inn"),
		purpose: text("purpose"),
		matchStatus: text("match_status", {
			// manual — привязано руками; ignored — не клиентская оплата (свои
			// переводы, займы и т.п.), в учёт клиентов не идёт.
			enum: ["matched", "unmatched", "manual", "ignored"],
		}).notNull(),
		contactId: text("contact_id"),
		dealId: text("deal_id"),
		purchaseId: text("purchase_id"),
		/** Когда оплата отражена в Bitrix (комментарий, поля, итог клиента). */
		bitrixSyncedAt: timestamp("bitrix_synced_at"),
		raw: jsonb("raw"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("payments_source_external_idx").on(
			table.source,
			table.externalId,
		),
		index("payments_contact_idx").on(table.contactId),
		index("payments_purchase_idx").on(table.purchaseId),
		index("payments_match_status_idx").on(table.matchStatus),
	],
);

/**
 * Портало-зависимые настройки (по правилам проекта — не в env): коды
 * пользовательских полей Bitrix и стадия «Оплачено». Одна строка id='default'.
 * Пока поле не задано, соответствующая запись в Bitrix пропускается.
 */
export const paymentSettings = pgTable("payment_settings", {
	id: text("id").primaryKey(),
	/** UF-поле контакта «Всего оплачено (Т-Банк)», тип «Число». */
	contactTotalField: text("contact_total_field"),
	/** UF-поле контакта «Дата последней оплаты». */
	contactLastPaidField: text("contact_last_paid_field"),
	/** UF-поле сделки «Оплачено», тип «Число». */
	dealPaidField: text("deal_paid_field"),
	/** STAGE_ID, в который переводится сделка после полной оплаты. */
	dealPaidStageId: text("deal_paid_stage_id"),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
