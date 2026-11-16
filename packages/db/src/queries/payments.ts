import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "../client.types";
import { deals } from "../schema/deals";
import {
	paymentProducts,
	paymentSettings,
	payments,
	purchases,
} from "../schema/payments";

export type PaymentProduct = typeof paymentProducts.$inferSelect;
export type Purchase = typeof purchases.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type PaymentSettings = typeof paymentSettings.$inferSelect;

const SETTINGS_ID = "default";

export async function getPaymentSettings(
	db: Database,
): Promise<PaymentSettings | null> {
	if (!db) return null;
	const rows = await db
		.select()
		.from(paymentSettings)
		.where(eq(paymentSettings.id, SETTINGS_ID))
		.limit(1);
	return rows[0] ?? null;
}

export type PaymentSettingsPatch = Partial<
	Omit<PaymentSettings, "id" | "updatedAt">
>;

export async function upsertPaymentSettings(
	db: Database,
	patch: PaymentSettingsPatch,
): Promise<void> {
	if (!db) return;
	await db
		.insert(paymentSettings)
		.values({ id: SETTINGS_ID, ...patch })
		.onConflictDoUpdate({
			target: paymentSettings.id,
			set: { ...patch, updatedAt: new Date() },
		});
}

export async function getPaymentProduct(
	db: Database,
	id: string,
): Promise<PaymentProduct | null> {
	if (!db) return null;
	const rows = await db
		.select()
		.from(paymentProducts)
		.where(eq(paymentProducts.id, id))
		.limit(1);
	return rows[0] ?? null;
}

export async function upsertPaymentProduct(
	db: Database,
	product: Omit<PaymentProduct, "createdAt">,
): Promise<void> {
	if (!db) return;
	const { id, ...rest } = product;
	await db
		.insert(paymentProducts)
		.values(product)
		.onConflictDoUpdate({ target: paymentProducts.id, set: rest });
}

export async function listPaymentProducts(
	db: Database,
): Promise<PaymentProduct[]> {
	if (!db) return [];
	return db.select().from(paymentProducts).orderBy(asc(paymentProducts.name));
}

export interface NewPurchaseEntry {
	contactId: string;
	dealId?: string;
	productId?: string;
	title: string;
	kind: Purchase["kind"];
	amountKopecks: number;
	sessionsTotal?: number | null;
}

/** Создаёт покупку в статусе pending; id идёт в OrderId платежа эквайринга. */
export async function createPurchase(
	db: Database,
	entry: NewPurchaseEntry,
): Promise<Purchase | null> {
	if (!db) return null;
	const rows = await db
		.insert(purchases)
		.values({ id: crypto.randomUUID(), ...entry })
		.returning();
	return rows[0] ?? null;
}

export async function getPurchase(
	db: Database,
	id: string,
): Promise<Purchase | null> {
	if (!db) return null;
	const rows = await db
		.select()
		.from(purchases)
		.where(eq(purchases.id, id))
		.limit(1);
	return rows[0] ?? null;
}

export async function listPurchasesByContact(
	db: Database,
	contactId: string,
): Promise<Purchase[]> {
	if (!db) return [];
	return db
		.select()
		.from(purchases)
		.where(eq(purchases.contactId, contactId))
		.orderBy(desc(purchases.createdAt));
}

export async function listPendingPurchasesByContact(
	db: Database,
	contactId: string,
): Promise<Purchase[]> {
	if (!db) return [];
	return db
		.select()
		.from(purchases)
		.where(
			and(eq(purchases.contactId, contactId), eq(purchases.status, "pending")),
		)
		.orderBy(desc(purchases.createdAt));
}

/** Контакт сделки из локального зеркала deals (без похода в Bitrix). */
export async function getDealContactId(
	db: Database,
	dealId: string,
): Promise<string | null> {
	if (!db) return null;
	const rows = await db
		.select({ contactId: deals.contactId })
		.from(deals)
		.where(eq(deals.id, dealId))
		.limit(1);
	return rows[0]?.contactId ?? null;
}

export interface NewPaymentEntry {
	source: Payment["source"];
	externalId: string;
	amountKopecks: number;
	paidAt: Date;
	payerName?: string | null;
	payerInn?: string | null;
	purpose?: string | null;
	matchStatus: Payment["matchStatus"];
	contactId?: string | null;
	dealId?: string | null;
	purchaseId?: string | null;
	raw?: unknown;
}

/**
 * Записывает оплату; null — такая уже есть (повторное уведомление банка).
 * Именно по этому null вебхук понимает, что побочные операции уже делались.
 */
export async function insertPaymentIfNew(
	db: Database,
	entry: NewPaymentEntry,
): Promise<Payment | null> {
	if (!db) return null;
	const rows = await db
		.insert(payments)
		.values({ id: crypto.randomUUID(), ...entry })
		.onConflictDoNothing()
		.returning();
	return rows[0] ?? null;
}

export async function getPaymentByExternalId(
	db: Database,
	source: Payment["source"],
	externalId: string,
): Promise<Payment | null> {
	if (!db) return null;
	const rows = await db
		.select()
		.from(payments)
		.where(
			and(eq(payments.source, source), eq(payments.externalId, externalId)),
		)
		.limit(1);
	return rows[0] ?? null;
}

export async function getPaymentById(
	db: Database,
	id: string,
): Promise<Payment | null> {
	if (!db) return null;
	const rows = await db
		.select()
		.from(payments)
		.where(eq(payments.id, id))
		.limit(1);
	return rows[0] ?? null;
}

/** Помечает оплату возвращённой; null — не найдена или уже возвращена. */
export async function markPaymentRefunded(
	db: Database,
	source: Payment["source"],
	externalId: string,
): Promise<Payment | null> {
	if (!db) return null;
	const rows = await db
		.update(payments)
		.set({ status: "refunded", bitrixSyncedAt: null })
		.where(
			and(
				eq(payments.source, source),
				eq(payments.externalId, externalId),
				eq(payments.status, "paid"),
			),
		)
		.returning();
	return rows[0] ?? null;
}

/** Сумма действующих (не возвращённых) оплат по покупке, в копейках. */
export async function sumPaidKopecksByPurchase(
	db: Database,
	purchaseId: string,
): Promise<number> {
	if (!db) return 0;
	const rows = await db
		.select({ total: sql<number>`coalesce(sum(${payments.amountKopecks}), 0)` })
		.from(payments)
		.where(
			and(eq(payments.purchaseId, purchaseId), eq(payments.status, "paid")),
		);
	return Number(rows[0]?.total ?? 0);
}

export async function setPurchaseStatus(
	db: Database,
	id: string,
	status: Purchase["status"],
	paidAt?: Date | null,
): Promise<void> {
	if (!db) return;
	await db
		.update(purchases)
		.set({
			status,
			...(paidAt !== undefined ? { paidAt } : {}),
			updatedAt: new Date(),
		})
		.where(eq(purchases.id, id));
}

export interface ContactPaymentTotals {
	totalKopecks: number;
	paymentsCount: number;
	lastPaidAt: Date | null;
}

/**
 * Итог по клиенту — всегда SUM по таблице, а не инкремент счётчика: возвраты,
 * ручная привязка и повторный разбор не могут разойтись с реальностью.
 */
export async function getContactPaymentTotals(
	db: Database,
	contactId: string,
): Promise<ContactPaymentTotals> {
	if (!db) return { totalKopecks: 0, paymentsCount: 0, lastPaidAt: null };
	const rows = await db
		.select({
			total: sql<number>`coalesce(sum(${payments.amountKopecks}), 0)`,
			count: sql<number>`count(*)`,
			last: sql<Date | null>`max(${payments.paidAt})`,
		})
		.from(payments)
		.where(and(eq(payments.contactId, contactId), eq(payments.status, "paid")));
	const row = rows[0];
	return {
		totalKopecks: Number(row?.total ?? 0),
		paymentsCount: Number(row?.count ?? 0),
		lastPaidAt: row?.last ? new Date(row.last) : null,
	};
}

export async function markPaymentBitrixSynced(
	db: Database,
	id: string,
): Promise<void> {
	if (!db) return;
	await db
		.update(payments)
		.set({ bitrixSyncedAt: new Date() })
		.where(eq(payments.id, id));
}

/** Привязанные оплаты, ещё не отражённые в Bitrix (повтор после сбоя). */
export async function listPaymentsPendingBitrixSync(
	db: Database,
	limit = 50,
): Promise<Payment[]> {
	if (!db) return [];
	return db
		.select()
		.from(payments)
		.where(
			and(
				isNull(payments.bitrixSyncedAt),
				sql`${payments.contactId} is not null`,
			),
		)
		.orderBy(asc(payments.createdAt))
		.limit(limit);
}

/** Очередь ручного разбора: оплаты, которые не удалось привязать к клиенту. */
export async function listUnmatchedPayments(
	db: Database,
	limit = 100,
): Promise<Payment[]> {
	if (!db) return [];
	return db
		.select()
		.from(payments)
		.where(eq(payments.matchStatus, "unmatched"))
		.orderBy(desc(payments.paidAt))
		.limit(limit);
}

/** Убирает оплату из очереди разбора: это не оплата клиента. */
export async function ignorePayment(
	db: Database,
	id: string,
): Promise<Payment | null> {
	if (!db) return null;
	const rows = await db
		.update(payments)
		.set({ matchStatus: "ignored" })
		.where(and(eq(payments.id, id), eq(payments.matchStatus, "unmatched")))
		.returning();
	return rows[0] ?? null;
}

export interface PaymentAssignment {
	contactId: string;
	dealId?: string | null;
	purchaseId?: string | null;
}

/** Ручная привязка оплаты из очереди неразобранных. */
export async function assignPayment(
	db: Database,
	id: string,
	assignment: PaymentAssignment,
): Promise<Payment | null> {
	if (!db) return null;
	const rows = await db
		.update(payments)
		.set({
			...assignment,
			matchStatus: "manual",
			bitrixSyncedAt: null,
		})
		.where(eq(payments.id, id))
		.returning();
	return rows[0] ?? null;
}
