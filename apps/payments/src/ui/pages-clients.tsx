import {
	createPurchase,
	getContactPaymentTotals,
	getPaymentProduct,
	getPurchase,
	listPaymentProducts,
	listPayments,
	listPurchasesByContact,
	type Purchase,
} from "@psi-opora/db/queries";
import { Hono } from "hono";
import type { FC } from "hono/jsx";
import { createPaymentLink } from "../tbank-init";
import { getContactNames, searchContacts } from "./bitrix-contacts";
import {
	date,
	dateTime,
	KIND,
	parseRubles,
	PURCHASE_STATUS,
	rub,
} from "./format";
import { Badge, Layout } from "./layout";
import { PaymentsTable } from "./pages-payments";

export const clientPages = new Hono();

const purchaseTone = (p: Purchase): "ok" | "warn" | "bad" | "gray" =>
	p.status === "paid"
		? "ok"
		: p.status === "pending"
			? "warn"
			: p.status === "refunded"
				? "bad"
				: "gray";

const PurchasesTable: FC<{ purchases: Purchase[] }> = ({ purchases }) =>
	purchases.length === 0 ? (
		<div class="empty">Покупок пока нет</div>
	) : (
		<table>
			<thead>
				<tr>
					<th>Создана</th>
					<th>Что куплено</th>
					<th>Сделка</th>
					<th>Статус</th>
					<th>Сессии</th>
					<th class="num">Сумма</th>
					<th />
				</tr>
			</thead>
			<tbody>
				{purchases.map((p) => (
					<tr>
						<td>{date(p.createdAt)}</td>
						<td>
							{p.title} <span class="muted">· {KIND[p.kind] ?? p.kind}</span>
						</td>
						<td>{p.dealId ?? "—"}</td>
						<td>
							<Badge
								tone={purchaseTone(p)}
								text={PURCHASE_STATUS[p.status] ?? p.status}
							/>
							{p.paidAt && <div class="muted">{dateTime(p.paidAt)}</div>}
						</td>
						<td>
							{p.sessionsTotal != null
								? `${p.sessionsUsed} из ${p.sessionsTotal}`
								: "—"}
						</td>
						<td class="num">{rub(p.amountKopecks)}</td>
						<td>
							{p.status === "pending" && (
								<form
									method="post"
									action={`/ui/purchases/${p.id}/link`}
									class="inline"
								>
									<button type="submit" class="secondary">
										Ссылка на оплату
									</button>
								</form>
							)}
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);

clientPages.get("/clients", async (c) => {
	const q = (c.req.query("q") ?? "").trim();
	const found = q ? await searchContacts(q) : [];
	return c.html(
		<Layout title="Клиенты" active="clients">
			<h1>Клиенты</h1>
			<form method="get" action="/ui/clients" class="row">
				<label>
					ФИО, телефон или ID контакта Bitrix24
					<input name="q" value={q} style="min-width:320px" autofocus />
				</label>
				<button type="submit">Найти</button>
			</form>
			{q && (
				<>
					<h2>Результаты</h2>
					{found.length === 0 ? (
						<div class="empty">
							Никого не нашли (или Bitrix24 недоступен) — попробуйте ID контакта
						</div>
					) : (
						<table>
							<tbody>
								{found.map((f) => (
									<tr>
										<td>
											<a href={`/ui/clients/${f.id}`}>{f.name}</a>
										</td>
										<td class="muted num">ID {f.id}</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</>
			)}
		</Layout>,
	);
});

clientPages.get("/clients/:contactId", async (c) => {
	const contactId = c.req.param("contactId");
	if (!/^\d+$/.test(contactId)) return c.notFound();
	const [totals, purchases, payments, products, names] = await Promise.all([
		getContactPaymentTotals(contactId),
		listPurchasesByContact(contactId),
		listPayments({ contactId, limit: 100 }),
		listPaymentProducts(),
		getContactNames([contactId]),
	]);
	const name = names.get(contactId) ?? `Контакт ${contactId}`;
	const active = products.filter((p) => p.active);
	return c.html(
		<Layout title={name} active="clients">
			<h1>{name}</h1>
			<div class="cards">
				<div class="card">
					<div class="label">Всего оплачено (Т-Банк)</div>
					<div class="value">{rub(totals.totalKopecks)}</div>
				</div>
				<div class="card">
					<div class="label">Оплат</div>
					<div class="value">{totals.paymentsCount}</div>
				</div>
				<div class="card">
					<div class="label">Последняя оплата</div>
					<div class="value">{date(totals.lastPaidAt)}</div>
				</div>
			</div>

			<h2>Покупки</h2>
			<PurchasesTable purchases={purchases} />

			<h2>Новая покупка</h2>
			{active.length === 0 ? (
				<div class="empty">
					Каталог пуст — сначала добавьте пакеты и курсы на вкладке{" "}
					<a href="/ui/products">«Каталог»</a>
				</div>
			) : (
				<form method="post" action="/ui/purchases" class="row">
					<input type="hidden" name="contactId" value={contactId} />
					<label>
						Продукт
						<select name="productId" required>
							{active.map((p) => (
								<option value={p.id}>
									{p.name} — {rub(p.priceKopecks)}
								</option>
							))}
						</select>
					</label>
					<label>
						Сделка Bitrix (ID)
						<input class="sm" name="dealId" />
					</label>
					<label>
						Своя цена, ₽ (необязательно)
						<input class="sm" name="amount" />
					</label>
					<button type="submit">Создать</button>
				</form>
			)}

			<h2>Оплаты</h2>
			<PaymentsTable payments={payments} names={names} />
		</Layout>,
	);
});

clientPages.post("/purchases", async (c) => {
	const body = await c.req.parseBody();
	const contactId = String(body.contactId ?? "").trim();
	const dealId = String(body.dealId ?? "").trim();
	const amountRaw = String(body.amount ?? "").trim();
	if (!/^\d+$/.test(contactId) || (dealId && !/^\d+$/.test(dealId))) {
		return c.text("ID контакта и сделки — числа", 400);
	}
	const product = await getPaymentProduct(String(body.productId ?? ""));
	if (!product) return c.text("Продукт не найден", 404);
	const custom = amountRaw ? parseRubles(amountRaw) : null;
	if (amountRaw && (custom === null || custom <= 0)) {
		return c.text("Сумма — число, например 12500 или 12500,50", 400);
	}
	await createPurchase({
		contactId,
		dealId: dealId || undefined,
		productId: product.id,
		title: product.name,
		kind: product.kind,
		amountKopecks: custom ?? product.priceKopecks,
		sessionsTotal: product.sessionsCount,
	});
	return c.redirect(`/ui/clients/${contactId}`);
});

clientPages.post("/purchases/:id/link", async (c) => {
	const purchase = await getPurchase(c.req.param("id"));
	if (!purchase) return c.notFound();
	if (purchase.status !== "pending") {
		return c.redirect(`/ui/clients/${purchase.contactId}`);
	}
	try {
		const { paymentUrl } = await createPaymentLink(purchase);
		return c.html(
			<Layout title="Ссылка на оплату" active="clients">
				<h1>Ссылка на оплату</h1>
				<p>
					{purchase.title} — {rub(purchase.amountKopecks)}. Отправьте ссылку
					клиенту: после оплаты она сама попадёт в учёт и в Bitrix24.
				</p>
				<div class="card">
					<a class="mono" href={paymentUrl}>
						{paymentUrl}
					</a>
				</div>
				<p>
					<a href={`/ui/clients/${purchase.contactId}`}>← К клиенту</a>
				</p>
			</Layout>,
		);
	} catch (err) {
		console.error(`[payments] ссылка на оплату ${purchase.id}: ${err}`);
		return c.html(
			<Layout title="Ссылка на оплату" active="clients">
				<h1>Не удалось создать ссылку</h1>
				<div class="notice">{(err as Error).message}</div>
				<p>
					<a href={`/ui/clients/${purchase.contactId}`}>← К клиенту</a>
				</p>
			</Layout>,
			502,
		);
	}
});
