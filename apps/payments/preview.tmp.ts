import { mock } from "bun:test";

const now = new Date();
const mk = (over: Record<string, unknown>) => ({
	id: "p",
	source: "tbank_account",
	externalId: "x",
	amountKopecks: 150_000,
	status: "paid",
	paidAt: now,
	payerName: "Иванов Иван",
	payerInn: null,
	purpose: "Оплата по сделке 10",
	matchStatus: "matched",
	contactId: "123",
	dealId: "10",
	purchaseId: null,
	bitrixSyncedAt: now,
	raw: null,
	createdAt: now,
	...over,
});
const payments = [
	mk({ id: "1" }),
	mk({
		id: "2",
		source: "tbank_acquiring",
		amountKopecks: 1_000_000,
		payerName: null,
		purpose: "Эквайринг, заказ 9f2c",
	}),
	mk({
		id: "3",
		matchStatus: "unmatched",
		contactId: null,
		amountKopecks: 350_000,
	}),
	mk({ id: "4", status: "refunded", amountKopecks: 200_000 }),
];
const purchases = [
	{
		id: "a",
		contactId: "123",
		dealId: "10",
		productId: "pack5",
		title: "Пакет 5 сессий",
		kind: "package",
		amountKopecks: 1_000_000,
		sessionsTotal: 5,
		sessionsUsed: 1,
		status: "paid",
		paidAt: now,
		expiresAt: null,
		createdAt: now,
		updatedAt: now,
	},
	{
		id: "b",
		contactId: "123",
		dealId: null,
		productId: "course",
		title: "Курс «Опора»",
		kind: "course",
		amountKopecks: 1_980_000,
		sessionsTotal: null,
		sessionsUsed: 0,
		status: "pending",
		paidAt: null,
		expiresAt: null,
		createdAt: now,
		updatedAt: now,
	},
];
const products = [
	{
		id: "pack5",
		kind: "package",
		name: "Пакет 5 сессий",
		priceKopecks: 1_000_000,
		sessionsCount: 5,
		validDays: 180,
		active: true,
		createdAt: now,
	},
	{
		id: "course",
		kind: "course",
		name: "Курс «Опора»",
		priceKopecks: 1_980_000,
		sessionsCount: null,
		validDays: null,
		active: true,
		createdAt: now,
	},
];

mock.module("@psi-opora/config", () => ({
	env: { PAYMENTS_ADMIN_TOKEN: "tok" },
}));
mock.module("@psi-opora/bitrix-client", () => ({
	resolveBitrixApi: () => null,
}));
mock.module("@psi-opora/db/queries", () => ({
	getPaymentStats: async () => ({
		paidTotalKopecks: 5_000_000,
		paidLast30DaysKopecks: 1_150_000,
		unmatchedCount: 1,
		unmatchedKopecks: 350_000,
		pendingPurchases: 1,
	}),
	listPayments: async (f: { matchStatus?: string } = {}) =>
		f.matchStatus
			? payments.filter((p) => p.matchStatus === f.matchStatus)
			: payments,
	getContactPaymentTotals: async () => ({
		totalKopecks: 1_150_000,
		paymentsCount: 3,
		lastPaidAt: now,
	}),
	listPurchasesByContact: async () => purchases,
	listPaymentProducts: async () => products,
	getPaymentProduct: async (id: string) =>
		products.find((p) => p.id === id) ?? null,
	getPaymentSettings: async () => null,
	getPaymentById: async () => null,
	assignPayment: async () => null,
	ignorePayment: async () => null,
	getPurchase: async () => null,
	createPurchase: async () => null,
	upsertPaymentSettings: async () => undefined,
	upsertPaymentProduct: async () => undefined,
	markPaymentBitrixSynced: async () => undefined,
	setPurchaseStatus: async () => undefined,
	sumPaidKopecksByPurchase: async () => 0,
}));

const { Hono } = await import("hono");
const { ui } = await import("./src/ui");
const app = new Hono();
app.route("/ui", ui);
export default { port: 3099, fetch: app.fetch };
