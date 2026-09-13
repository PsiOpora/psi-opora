import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "../client.types";
import { bookPreorderOrders } from "../schema/book-preorder-orders";

export type BookPreorderOrder = typeof bookPreorderOrders.$inferSelect;
export type BookPreorderOrderStatus = BookPreorderOrder["status"];

export interface NewBookPreorderOrderEntry {
	messenger: string;
	userId: string;
	chatId?: string;
	name?: string;
	phone?: string;
	email?: string;
	consentAt?: Date;
	dealId?: number;
	paymentChoice?: "immediate" | "deferred";
	source?: string;
	campaign?: string;
	ymClientId?: string;
}

function orderId(messenger: string, userId: string): string {
	return `${messenger}:${userId}`;
}

/**
 * Создаёт заказ (одна бронь на пользователя — повторный вход в сценарий не
 * плодит новые строки) и сразу возвращает актуальную строку — новую или уже
 * существующую (id детерминирован из messenger+userId, см. orderId).
 */
export async function upsertBookPreorderOrder(
	db: Database,
	entry: NewBookPreorderOrderEntry,
): Promise<BookPreorderOrder | null> {
	if (!db) return null;
	const id = orderId(entry.messenger, entry.userId);
	await db
		.insert(bookPreorderOrders)
		.values({ id, ...entry })
		.onConflictDoNothing({ target: bookPreorderOrders.id });
	const rows = await db
		.select()
		.from(bookPreorderOrders)
		.where(eq(bookPreorderOrders.id, id))
		.limit(1);
	return rows[0] ?? null;
}

export async function getBookPreorderOrder(
	db: Database,
	messenger: string,
	userId: string,
): Promise<BookPreorderOrder | null> {
	if (!db) return null;
	const rows = await db
		.select()
		.from(bookPreorderOrders)
		.where(eq(bookPreorderOrders.id, orderId(messenger, userId)))
		.limit(1);
	return rows[0] ?? null;
}

export async function getBookPreorderOrderByOrderNo(
	db: Database,
	orderNo: number,
): Promise<BookPreorderOrder | null> {
	if (!db) return null;
	const rows = await db
		.select()
		.from(bookPreorderOrders)
		.where(eq(bookPreorderOrders.orderNo, orderNo))
		.limit(1);
	return rows[0] ?? null;
}

/** Заказы в статусе "reserved" — источник для цепочки напоминаний Б1–Б6
 * (packages/jobs/src/book-preorder-drip.ts решает по датам, кому пора писать). */
export async function listReservedBookPreorderOrders(
	db: Database,
): Promise<BookPreorderOrder[]> {
	if (!db) return [];
	return db
		.select()
		.from(bookPreorderOrders)
		.where(eq(bookPreorderOrders.status, "reserved"));
}

export async function markBookPreorderAwaitingPayment(
	db: Database,
	id: string,
	patch: { email?: string; dealId?: number },
): Promise<void> {
	if (!db) return;
	await db
		.update(bookPreorderOrders)
		.set({
			status: "awaiting_payment",
			paymentChoice: "immediate",
			updatedAt: sql`now()`,
			...patch,
		})
		.where(eq(bookPreorderOrders.id, id));
}

export async function markBookPreorderPaid(
	db: Database,
	orderNo: number,
): Promise<BookPreorderOrder | null> {
	if (!db) return null;
	const rows = await db
		.update(bookPreorderOrders)
		.set({ status: "paid", paidAt: sql`now()`, updatedAt: sql`now()` })
		.where(
			and(
				eq(bookPreorderOrders.orderNo, orderNo),
				// Идемпотентность: повторный вебхук об этом же платеже не должен
				// повторно запускать запрос адреса доставки клиенту.
				eq(bookPreorderOrders.status, "awaiting_payment"),
			),
		)
		.returning();
	return rows[0] ?? null;
}

export async function markBookPreorderDeclined(
	db: Database,
	id: string,
): Promise<void> {
	if (!db) return;
	await db
		.update(bookPreorderOrders)
		.set({ status: "declined", declinedAt: sql`now()`, updatedAt: sql`now()` })
		.where(eq(bookPreorderOrders.id, id));
}

export async function setBookPreorderShipping(
	db: Database,
	id: string,
	shipping: {
		shippingName: string;
		shippingAddress: string;
		promoCode: string;
	},
): Promise<void> {
	if (!db) return;
	await db
		.update(bookPreorderOrders)
		.set({ ...shipping, updatedAt: sql`now()` })
		.where(eq(bookPreorderOrders.id, id));
}

export async function setBookPreorderPriceDeadline(
	db: Database,
	id: string,
	preorderPriceExpiresAt: Date,
): Promise<void> {
	if (!db) return;
	await db
		.update(bookPreorderOrders)
		.set({ preorderPriceExpiresAt, updatedAt: sql`now()` })
		.where(eq(bookPreorderOrders.id, id));
}

export async function recordBookPreorderDripStep(
	db: Database,
	id: string,
	dripStep: number,
): Promise<void> {
	if (!db) return;
	await db
		.update(bookPreorderOrders)
		.set({ dripStep, dripLastSentAt: sql`now()`, updatedAt: sql`now()` })
		.where(eq(bookPreorderOrders.id, id));
}

export async function recordBookPreorderDripDeferred(
	db: Database,
	id: string,
): Promise<void> {
	if (!db) return;
	await db
		.update(bookPreorderOrders)
		.set({ dripDeferredAt: sql`now()`, updatedAt: sql`now()` })
		.where(
			and(
				eq(bookPreorderOrders.id, id),
				isNull(bookPreorderOrders.dripDeferredAt),
			),
		);
}

export async function recordBookPreorderDripAnyClick(
	db: Database,
	id: string,
): Promise<void> {
	if (!db) return;
	await db
		.update(bookPreorderOrders)
		.set({ dripAnyClickAt: sql`now()` })
		.where(
			and(
				eq(bookPreorderOrders.id, id),
				isNull(bookPreorderOrders.dripAnyClickAt),
			),
		);
}
