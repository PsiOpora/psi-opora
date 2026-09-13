import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Предзаказ книги «Тело берёт своё» (лендинг psi-opora.ru/telo-beret-svoe/).
 * Одна запись на пользователя — id = `${messenger}:${userId}` (как
 * bot_guide_deliveries), т.к. второй предзаказ от того же человека не
 * предусмотрен сценарием. orderNo — короткий номер для клиента («заказ №»),
 * не совпадает с ID сделки Bitrix (та может не создаться/задержаться).
 *
 * dripStep/dripLastSentAt/dripDeferredAt/dripAnyClickAt обслуживают цепочку
 * напоминаний Б1–Б6 (packages/jobs/src/book-preorder-drip.ts): дата отсчёта —
 * общий для всех глобальный bot_texts-ключ book_ready_date, а не поле здесь.
 */
export const bookPreorderOrders = pgTable("book_preorder_orders", {
	id: text("id").primaryKey(),
	orderNo: serial("order_no").notNull(),
	messenger: text("messenger").notNull(),
	userId: text("user_id").notNull(),
	chatId: text("chat_id"),

	name: text("name"),
	phone: text("phone"),
	email: text("email"),
	consentAt: timestamp("consent_at"),

	dealId: integer("deal_id"),

	/** reserved — бесплатная бронь, ждёт тиража; awaiting_payment — выбрал
	 * оплату сразу и ждём вебхук; paid — оплачено; declined — отменил бронь
	 * или отказался от согласия; cancelled зарезервировано на будущее. */
	status: text("status", {
		enum: ["reserved", "awaiting_payment", "paid", "declined", "cancelled"],
	})
		.notNull()
		.default("reserved"),
	paymentChoice: text("payment_choice", { enum: ["immediate", "deferred"] }),

	reservedAt: timestamp("reserved_at").defaultNow().notNull(),
	paidAt: timestamp("paid_at"),
	declinedAt: timestamp("declined_at"),
	/** Побочные операции вебхука об оплате (apps/bitrix-webhook) отмечаются
	 * отдельно от paidAt — иначе повторный вебхук по уже оплаченному заказу
	 * не смог бы доставить упавшее с первого раза уведомление клиенту или
	 * обновление сделки в Bitrix (см. handlePayformWebhook). */
	paidNotifiedAt: timestamp("paid_notified_at"),
	dealPaidSyncedAt: timestamp("deal_paid_synced_at"),

	/** Снимок дедлайна цены предзаказа (1980 ₽) на момент старта цепочки Б1–Б6. */
	preorderPriceExpiresAt: timestamp("preorder_price_expires_at"),
	dripStep: integer("drip_step").notNull().default(0),
	dripLastSentAt: timestamp("drip_last_sent_at"),
	/** Клик «Не сейчас» на Б1 — по нему пропускаем Б2–Б4 (см. listDueBookPreorderDrip). */
	dripDeferredAt: timestamp("drip_deferred_at"),
	/** Любой клик по кнопке на Б1–Б3 — по нему решаем, пропускать ли Б4. */
	dripAnyClickAt: timestamp("drip_any_click_at"),

	shippingName: text("shipping_name"),
	shippingAddress: text("shipping_address"),
	promoCode: text("promo_code"),

	source: text("source"),
	campaign: text("campaign"),
	ymClientId: text("ym_client_id"),

	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
