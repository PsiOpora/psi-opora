import {
	assignPayment,
	getPaymentById,
	getPaymentStats,
	ignorePayment,
	listPayments,
	type Payment,
} from "@psi-opora/db/queries";
import { Hono } from "hono";
import type { FC } from "hono/jsx";
import { processPayment } from "../process-payment";
import { getContactNames } from "./bitrix-contacts";
import { dateTime, MATCH_STATUS, rub, SOURCE } from "./format";
import { Badge, ContactLink, Layout } from "./layout";

export const paymentPages = new Hono();

const matchTone = (p: Payment): "ok" | "warn" | "bad" | "gray" =>
	p.status === "refunded"
		? "bad"
		: p.matchStatus === "unmatched"
			? "warn"
			: p.matchStatus === "ignored"
				? "gray"
				: "ok";

export const PaymentsTable: FC<{
	payments: Payment[];
	names: Map<string, string>;
}> = ({ payments, names }) =>
	payments.length === 0 ? (
		<div class="empty">Оплат пока нет</div>
	) : (
		<table>
			<thead>
				<tr>
					<th>Дата</th>
					<th>Клиент</th>
					<th>Источник</th>
					<th>Плательщик / назначение</th>
					<th>Статус</th>
					<th class="num">Сумма</th>
				</tr>
			</thead>
			<tbody>
				{payments.map((p) => (
					<tr>
						<td>{dateTime(p.paidAt)}</td>
						<td>
							<ContactLink id={p.contactId} names={names} />
						</td>
						<td>{SOURCE[p.source] ?? p.source}</td>
						<td>
							{p.payerName && <div>{p.payerName}</div>}
							<div class="muted">{p.purpose ?? "—"}</div>
						</td>
						<td>
							<Badge
								tone={matchTone(p)}
								text={
									p.status === "refunded"
										? "Возврат"
										: (MATCH_STATUS[p.matchStatus] ?? p.matchStatus)
								}
							/>
						</td>
						<td class="num">{rub(p.amountKopecks)}</td>
					</tr>
				))}
			</tbody>
		</table>
	);

const namesFor = (payments: Payment[]) =>
	getContactNames(payments.map((p) => p.contactId ?? ""));

paymentPages.get("/", async (c) => {
	const [stats, recent] = await Promise.all([
		getPaymentStats(),
		listPayments({ limit: 15 }),
	]);
	const names = await namesFor(recent);
	return c.html(
		<Layout title="Сводка" active="home">
			<h1>Сводка</h1>
			{stats.unmatchedCount > 0 && (
				<div class="notice">
					Не разобрано оплат: {stats.unmatchedCount} на{" "}
					{rub(stats.unmatchedKopecks)} —{" "}
					<a href="/ui/unmatched">привязать к клиентам</a>
				</div>
			)}
			<div class="cards">
				<div class="card">
					<div class="label">Оплачено клиентами, всего</div>
					<div class="value">{rub(stats.paidTotalKopecks)}</div>
				</div>
				<div class="card">
					<div class="label">За последние 30 дней</div>
					<div class="value">{rub(stats.paidLast30DaysKopecks)}</div>
				</div>
				<div class="card">
					<div class="label">Покупок ждут оплаты</div>
					<div class="value">{stats.pendingPurchases}</div>
				</div>
				<div class="card">
					<div class="label">Не разобрано</div>
					<div class="value">{stats.unmatchedCount}</div>
				</div>
			</div>
			<h2>Последние оплаты</h2>
			<PaymentsTable payments={recent} names={names} />
		</Layout>,
	);
});

paymentPages.get("/payments", async (c) => {
	const payments = await listPayments({ limit: 200 });
	const names = await namesFor(payments);
	return c.html(
		<Layout title="Оплаты" active="payments">
			<h1>Оплаты Т-Банка</h1>
			<PaymentsTable payments={payments} names={names} />
		</Layout>,
	);
});

paymentPages.get("/unmatched", async (c) => {
	const payments = await listPayments({ matchStatus: "unmatched", limit: 200 });
	return c.html(
		<Layout title="Не разобрано" active="unmatched">
			<h1>Не разобранные оплаты</h1>
			<p class="muted">
				Оплаты, которые не удалось привязать к клиенту автоматически. Укажите ID
				контакта Bitrix24 (его можно найти на вкладке «Клиенты») — оплата
				попадёт в итог клиента и в Bitrix.
			</p>
			{payments.length === 0 ? (
				<div class="empty">Всё разобрано</div>
			) : (
				<table>
					<thead>
						<tr>
							<th>Дата</th>
							<th>Плательщик / назначение</th>
							<th class="num">Сумма</th>
							<th>Привязать</th>
						</tr>
					</thead>
					<tbody>
						{payments.map((p) => (
							<tr>
								<td>{dateTime(p.paidAt)}</td>
								<td>
									{p.payerName && <div>{p.payerName}</div>}
									<div class="muted">{p.purpose ?? "—"}</div>
								</td>
								<td class="num">{rub(p.amountKopecks)}</td>
								<td>
									<form
										method="post"
										action={`/ui/payments/${p.id}/assign`}
										class="inline"
									>
										<input
											class="sm"
											name="contactId"
											placeholder="ID контакта"
											required
										/>{" "}
										<input class="sm" name="dealId" placeholder="ID сделки" />{" "}
										<button type="submit">Привязать</button>
									</form>{" "}
									<form
										method="post"
										action={`/ui/payments/${p.id}/ignore`}
										class="inline"
									>
										<button type="submit" class="secondary">
											Не оплата клиента
										</button>
									</form>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</Layout>,
	);
});

paymentPages.post("/payments/:id/assign", async (c) => {
	const id = c.req.param("id");
	const body = await c.req.parseBody();
	const contactId = String(body.contactId ?? "").trim();
	const dealId = String(body.dealId ?? "").trim();
	if (!/^\d+$/.test(contactId) || (dealId && !/^\d+$/.test(dealId))) {
		return c.text("ID контакта и сделки — числа", 400);
	}
	if (!(await getPaymentById(id))) return c.text("Оплата не найдена", 404);
	const payment = await assignPayment(id, {
		contactId,
		dealId: dealId || null,
	});
	if (payment) {
		// Сбой Bitrix не отменяет привязку — оплату догонит тикер повторов.
		await processPayment(payment).catch((err) =>
			console.error(`[payments] привязка ${id}: ${err}`),
		);
	}
	return c.redirect("/ui/unmatched");
});

paymentPages.post("/payments/:id/ignore", async (c) => {
	await ignorePayment(c.req.param("id"));
	return c.redirect("/ui/unmatched");
});
