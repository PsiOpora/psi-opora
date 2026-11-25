import { timingSafeEqual } from "node:crypto";
import { env } from "@psi-opora/config";
import {
	assignPayment,
	createPurchase,
	getContactPaymentTotals,
	getPaymentById,
	getPaymentProduct,
	getPurchase,
	ignorePayment,
	listPaymentProducts,
	listPurchasesByContact,
	listUnmatchedPayments,
	upsertPaymentProduct,
	upsertPaymentSettings,
} from "@psi-opora/db/queries";
import { Hono } from "hono";
import { z } from "zod";
import { processPayment } from "./process-payment";
import { createPaymentLink } from "./tbank-init";

/**
 * Админ-API учёта оплат под Bearer PAYMENTS_ADMIN_TOKEN — пока без UI:
 * его вызывают менеджерские инструменты/скрипты, а экраны дашборда
 * (карточка клиента, очередь неразобранных) строятся поверх этих же ручек.
 */

export const adminApi = new Hono();

adminApi.use("*", async (c, next) => {
	const token = env.PAYMENTS_ADMIN_TOKEN;
	if (!token) return c.text("Not configured", 500);
	const expected = Buffer.from(`Bearer ${token}`);
	const actual = Buffer.from(c.req.header("authorization") ?? "");
	if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
		return c.text("Unauthorized", 401);
	}
	await next();
});

const productSchema = z.object({
	kind: z.enum(["package", "course"]),
	name: z.string().min(1),
	priceKopecks: z.number().int().positive(),
	sessionsCount: z.number().int().positive().nullable().default(null),
	validDays: z.number().int().positive().nullable().default(null),
	active: z.boolean().default(true),
});

adminApi.get("/products", async (c) => c.json(await listPaymentProducts()));

adminApi.put("/products/:id", async (c) => {
	const parsed = productSchema.safeParse(await c.req.json());
	if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
	await upsertPaymentProduct({ id: c.req.param("id"), ...parsed.data });
	return c.json({ ok: true });
});

const purchaseSchema = z.object({
	contactId: z.string().min(1),
	dealId: z.string().optional(),
	productId: z.string().min(1),
	/** Индивидуальная цена вместо прайсовой (скидка, рассрочка). */
	amountKopecks: z.number().int().positive().optional(),
});

adminApi.post("/purchases", async (c) => {
	const parsed = purchaseSchema.safeParse(await c.req.json());
	if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
	const product = await getPaymentProduct(parsed.data.productId);
	if (!product) return c.json({ error: "продукт не найден" }, 404);
	const purchase = await createPurchase({
		contactId: parsed.data.contactId,
		dealId: parsed.data.dealId,
		productId: product.id,
		title: product.name,
		kind: product.kind,
		amountKopecks: parsed.data.amountKopecks ?? product.priceKopecks,
		sessionsTotal: product.sessionsCount,
	});
	return c.json(purchase, 201);
});

adminApi.post("/purchases/:id/payment-link", async (c) => {
	const purchase = await getPurchase(c.req.param("id"));
	if (!purchase) return c.json({ error: "покупка не найдена" }, 404);
	if (purchase.status !== "pending") {
		return c.json({ error: "покупка уже не ожидает оплаты" }, 409);
	}
	return c.json(await createPaymentLink(purchase));
});

/** Карточка клиента: что купил и сколько всего заплатил. */
adminApi.get("/clients/:contactId", async (c) => {
	const contactId = c.req.param("contactId");
	const [purchases, totals] = await Promise.all([
		listPurchasesByContact(contactId),
		getContactPaymentTotals(contactId),
	]);
	return c.json({ contactId, totals, purchases });
});

adminApi.get("/payments/unmatched", async (c) =>
	c.json(await listUnmatchedPayments()),
);

const assignSchema = z.object({
	contactId: z.string().min(1),
	dealId: z.string().optional(),
	purchaseId: z.string().optional(),
});

adminApi.post("/payments/:id/assign", async (c) => {
	const parsed = assignSchema.safeParse(await c.req.json());
	if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
	const id = c.req.param("id");
	if (!(await getPaymentById(id))) return c.json({ error: "нет оплаты" }, 404);
	const payment = await assignPayment(id, parsed.data);
	if (payment) await processPayment(payment);
	return c.json({ ok: true });
});

adminApi.post("/payments/:id/ignore", async (c) => {
	const payment = await ignorePayment(c.req.param("id"));
	return payment
		? c.json({ ok: true })
		: c.json({ error: "нет в очереди" }, 404);
});

const settingsSchema = z.object({
	contactTotalField: z.string().nullable().optional(),
	contactLastPaidField: z.string().nullable().optional(),
	dealPaidField: z.string().nullable().optional(),
	dealPaidStageId: z.string().nullable().optional(),
});

adminApi.put("/settings", async (c) => {
	const parsed = settingsSchema.safeParse(await c.req.json());
	if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
	await upsertPaymentSettings(parsed.data);
	return c.json({ ok: true });
});
