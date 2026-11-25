import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../client.types";
import { payments, purchases } from "../schema/payments";
import type { Payment, Purchase } from "./payments";

/** Запросы для экранов apps/payments: списки и сводка. */

export interface PaymentListFilter {
	contactId?: string;
	matchStatus?: Payment["matchStatus"];
	limit?: number;
}

export async function listPayments(
	db: Database,
	filter: PaymentListFilter = {},
): Promise<Payment[]> {
	if (!db) return [];
	const conditions = [
		filter.contactId ? eq(payments.contactId, filter.contactId) : undefined,
		filter.matchStatus
			? eq(payments.matchStatus, filter.matchStatus)
			: undefined,
	].filter((c) => c !== undefined);
	return db
		.select()
		.from(payments)
		.where(conditions.length > 0 ? and(...conditions) : undefined)
		.orderBy(desc(payments.paidAt))
		.limit(filter.limit ?? 100);
}

export async function listRecentPurchases(
	db: Database,
	limit = 50,
): Promise<Purchase[]> {
	if (!db) return [];
	return db
		.select()
		.from(purchases)
		.orderBy(desc(purchases.createdAt))
		.limit(limit);
}

export interface PaymentStats {
	/** Привязанные к клиентам оплаты за всё время. */
	paidTotalKopecks: number;
	/** …и за последние 30 дней. */
	paidLast30DaysKopecks: number;
	unmatchedCount: number;
	unmatchedKopecks: number;
	pendingPurchases: number;
}

export async function getPaymentStats(db: Database): Promise<PaymentStats> {
	const empty: PaymentStats = {
		paidTotalKopecks: 0,
		paidLast30DaysKopecks: 0,
		unmatchedCount: 0,
		unmatchedKopecks: 0,
		pendingPurchases: 0,
	};
	if (!db) return empty;
	const [pay, pending] = await Promise.all([
		db
			.select({
				total: sql<number>`coalesce(sum(${payments.amountKopecks}) filter (where ${payments.status} = 'paid' and ${payments.matchStatus} in ('matched', 'manual')), 0)`,
				last30: sql<number>`coalesce(sum(${payments.amountKopecks}) filter (where ${payments.status} = 'paid' and ${payments.matchStatus} in ('matched', 'manual') and ${payments.paidAt} > now() - interval '30 days'), 0)`,
				unmatchedCount: sql<number>`count(*) filter (where ${payments.matchStatus} = 'unmatched')`,
				unmatchedSum: sql<number>`coalesce(sum(${payments.amountKopecks}) filter (where ${payments.matchStatus} = 'unmatched'), 0)`,
			})
			.from(payments),
		db
			.select({ count: sql<number>`count(*)` })
			.from(purchases)
			.where(eq(purchases.status, "pending")),
	]);
	const row = pay[0];
	return {
		...empty,
		paidTotalKopecks: Number(row?.total ?? 0),
		paidLast30DaysKopecks: Number(row?.last30 ?? 0),
		unmatchedCount: Number(row?.unmatchedCount ?? 0),
		unmatchedKopecks: Number(row?.unmatchedSum ?? 0),
		pendingPurchases: Number(pending[0]?.count ?? 0),
	};
}
