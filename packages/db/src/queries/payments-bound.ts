/**
 * Запросы учёта оплат (payments.ts) с подставленным `db` — тот же приём, что
 * обёртки в index.ts, вынесен отдельно, чтобы не раздувать index.ts.
 */
import { db } from "../client";
import * as q from "./payments";

export type {
	ContactPaymentTotals,
	NewPaymentEntry,
	NewPurchaseEntry,
	Payment,
	PaymentAssignment,
	PaymentProduct,
	PaymentSettings,
	PaymentSettingsPatch,
	Purchase,
} from "./payments";

export const getPaymentSettings = () => q.getPaymentSettings(db);
export const upsertPaymentSettings = (patch: q.PaymentSettingsPatch) =>
	q.upsertPaymentSettings(db, patch);

export const getPaymentProduct = (id: string) => q.getPaymentProduct(db, id);
export const listPaymentProducts = () => q.listPaymentProducts(db);
export const upsertPaymentProduct = (
	product: Parameters<typeof q.upsertPaymentProduct>[1],
) => q.upsertPaymentProduct(db, product);

export const createPurchase = (entry: q.NewPurchaseEntry) =>
	q.createPurchase(db, entry);
export const getPurchase = (id: string) => q.getPurchase(db, id);
export const listPurchasesByContact = (contactId: string) =>
	q.listPurchasesByContact(db, contactId);
export const listPendingPurchasesByContact = (contactId: string) =>
	q.listPendingPurchasesByContact(db, contactId);
export const getDealContactId = (dealId: string) =>
	q.getDealContactId(db, dealId);
export const setPurchaseStatus = (
	id: string,
	status: q.Purchase["status"],
	paidAt?: Date | null,
) => q.setPurchaseStatus(db, id, status, paidAt);

export const insertPaymentIfNew = (entry: q.NewPaymentEntry) =>
	q.insertPaymentIfNew(db, entry);
export const getPaymentByExternalId = (
	source: q.Payment["source"],
	externalId: string,
) => q.getPaymentByExternalId(db, source, externalId);
export const markPaymentRefunded = (
	source: q.Payment["source"],
	externalId: string,
) => q.markPaymentRefunded(db, source, externalId);
export const sumPaidKopecksByPurchase = (purchaseId: string) =>
	q.sumPaidKopecksByPurchase(db, purchaseId);
export const getContactPaymentTotals = (contactId: string) =>
	q.getContactPaymentTotals(db, contactId);
export const markPaymentBitrixSynced = (id: string) =>
	q.markPaymentBitrixSynced(db, id);
export const listPaymentsPendingBitrixSync = (limit?: number) =>
	q.listPaymentsPendingBitrixSync(db, limit);
export const listUnmatchedPayments = (limit?: number) =>
	q.listUnmatchedPayments(db, limit);
export const ignorePayment = (id: string) => q.ignorePayment(db, id);
export const getPaymentById = (id: string) => q.getPaymentById(db, id);
export const assignPayment = (id: string, assignment: q.PaymentAssignment) =>
	q.assignPayment(db, id, assignment);
