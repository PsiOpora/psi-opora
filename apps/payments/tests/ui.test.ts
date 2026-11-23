import { beforeAll, expect, mock, test } from "bun:test";

const now = new Date("2026-11-10T09:00:00Z");

const payment = {
	id: "pay-1",
	source: "tbank_account",
	externalId: "op-1",
	amountKopecks: 150_000,
	status: "paid",
	paidAt: now,
	payerName: "Иванов И.И.",
	payerInn: null,
	purpose: "Оплата по сделке 10",
	matchStatus: "unmatched",
	contactId: null,
	dealId: null,
	purchaseId: null,
	bitrixSyncedAt: null,
	raw: null,
	createdAt: now,
};

const purchase = {
	id: "pur-1",
	contactId: "123",
	dealId: "10",
	productId: "pack5",
	title: "Пакет 5 сессий",
	kind: "package",
	amountKopecks: 1_000_000,
	sessionsTotal: 5,
	sessionsUsed: 1,
	status: "pending",
	paidAt: null,
	expiresAt: null,
	createdAt: now,
	updatedAt: now,
};

const assignPayment = mock(async () => null);

mock.module("@psi-opora/config", () => ({
	env: { PAYMENTS_ADMIN_TOKEN: "tok", BITRIX_MEMBER_ID: undefined },
}));
mock.module("@psi-opora/bitrix-client", () => ({
	resolveBitrixApi: () => null,
}));
mock.module("@psi-opora/db/queries", () => ({
	getPaymentStats: async () => ({
		paidTotalKopecks: 5_000_000,
		paidLast30DaysKopecks: 1_000_000,
		unmatchedCount: 2,
		unmatchedKopecks: 300_000,
		pendingPurchases: 1,
	}),
	listPayments: async () => [payment],
	getContactPaymentTotals: async () => ({
		totalKopecks: 150_000,
		paymentsCount: 1,
		lastPaidAt: now,
	}),
	listPurchasesByContact: async () => [purchase],
	listPaymentProducts: async () => [
		{
			id: "pack5",
			kind: "package",
			name: "Пакет 5 сессий",
			priceKopecks: 1_000_000,
			sessionsCount: 5,
			validDays: null,
			active: true,
			createdAt: now,
		},
	],
	getPaymentById: async () => payment,
	assignPayment,
	ignorePayment: async () => null,
	getPaymentProduct: async () => null,
	getPurchase: async () => null,
	createPurchase: async () => null,
	getPaymentSettings: async () => null,
	upsertPaymentSettings: async () => undefined,
	upsertPaymentProduct: async () => undefined,
	// process-payment.ts
	getContactPaymentTotalsUnused: async () => null,
	markPaymentBitrixSynced: async () => undefined,
	setPurchaseStatus: async () => undefined,
	sumPaidKopecksByPurchase: async () => 0,
}));

let ui: { request: (path: string, init?: RequestInit) => Promise<Response> };
beforeAll(async () => {
	// Как в server.ts: экраны смонтированы под /ui.
	const { Hono } = await import("hono");
	const app = new Hono();
	app.route("/ui", (await import("../src/ui")).ui);
	ui = app;
});

const authed = { headers: { cookie: "payments_session=tok" } };

test("без сессии экраны уводят на вход", async () => {
	const res = await ui.request("/ui");
	expect(res.status).toBe(302);
	expect(res.headers.get("location")).toBe("/ui/login");
});

test("вход: неверный токен отклонён, верный выдаёт httpOnly-cookie", async () => {
	const form = (token: string) => ({
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: `token=${token}`,
	});
	const bad = await ui.request("/ui/login", form("nope"));
	expect(bad.headers.get("location")).toBe("/ui/login?error=1");
	expect(bad.headers.get("set-cookie")).toBeNull();

	const ok = await ui.request("/ui/login", form("tok"));
	expect(ok.headers.get("location")).toBe("/ui");
	const cookie = ok.headers.get("set-cookie") ?? "";
	expect(cookie).toContain("payments_session=tok");
	expect(cookie).toContain("HttpOnly");
	expect(cookie).toContain("SameSite=Strict");
});

test("сводка показывает цифры и предупреждение о неразобранных", async () => {
	const res = await ui.request("/ui", authed);
	expect(res.status).toBe(200);
	const html = await res.text();
	expect(html).toContain("Сводка");
	expect(html).toContain("Не разобрано оплат: 2");
	expect(html).toContain("Иванов И.И.");
});

test("карточка клиента: итог, покупки и форма новой покупки", async () => {
	const res = await ui.request("/ui/clients/123", authed);
	expect(res.status).toBe(200);
	const html = await res.text();
	expect(html).toContain("Всего оплачено (Т-Банк)");
	expect(html).toContain("Пакет 5 сессий");
	expect(html).toContain("Ссылка на оплату");
	expect(html).toContain("1 из 5");
});

test("некорректный ID контакта в карточке — 404", async () => {
	const res = await ui.request("/ui/clients/abc", authed);
	expect(res.status).toBe(404);
});

test("привязка оплаты: нечисловой ID контакта — 400 и без записи", async () => {
	const res = await ui.request("/ui/payments/pay-1/assign", {
		method: "POST",
		headers: {
			cookie: "payments_session=tok",
			"content-type": "application/x-www-form-urlencoded",
		},
		body: "contactId=abc",
	});
	expect(res.status).toBe(400);
	expect(assignPayment).not.toHaveBeenCalled();
});
