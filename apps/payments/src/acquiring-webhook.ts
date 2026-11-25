import { env } from "@psi-opora/config";
import { z } from "zod";
import { ingestAcquiringPayment, ingestAcquiringRefund } from "./ingest";
import { verifyTbankToken } from "./tbank-token";

/**
 * Уведомления эквайринга Т-Банка (Т-Касса) о смене статуса платежа.
 * Банк ждёт HTTP 200 и тело ровно `OK`, иначе шлёт повторно (раз в час в
 * течение суток, затем раз в день).
 * https://developer.tbank.ru/eacq/intro/developer/notification
 *
 * Деньги считаем по CONFIRMED (AUTHORIZED приходит одновременно и сумму не
 * подтверждает). REFUNDED снимает оплату с итогов клиента.
 */

const notificationSchema = z
	.object({
		TerminalKey: z.string(),
		OrderId: z.string(),
		Success: z.boolean(),
		Status: z.string(),
		PaymentId: z.union([z.string(), z.number()]),
		Amount: z.number().int().nonnegative(),
		Token: z.string(),
	})
	.passthrough();

const ok = () =>
	new Response("OK", {
		status: 200,
		headers: { "content-type": "text/plain" },
	});

export async function handleAcquiringWebhook(
	request: Request,
): Promise<Response> {
	const password = env.TBANK_TERMINAL_PASSWORD;
	if (!password) {
		console.error(
			"[payments] TBANK_TERMINAL_PASSWORD не задан — запрос отклонён",
		);
		return new Response("Not configured", { status: 500 });
	}

	let json: unknown;
	try {
		json = await request.json();
	} catch {
		return new Response("Bad Request", { status: 400 });
	}
	const parsed = notificationSchema.safeParse(json);
	if (!parsed.success) {
		console.warn("[payments] некорректное уведомление эквайринга");
		return new Response("Bad Request", { status: 400 });
	}
	const body = parsed.data;

	if (!verifyTbankToken(body, password)) {
		console.warn("[payments] неверная подпись уведомления эквайринга");
		return new Response("Unauthorized", { status: 401 });
	}
	// Чужой терминал с тем же паролем невозможен, но проверка дешёвая и
	// защищает от смешения, если в ЛК когда-нибудь заведут второй терминал.
	if (env.TBANK_TERMINAL_KEY && body.TerminalKey !== env.TBANK_TERMINAL_KEY) {
		return ok();
	}

	const paymentId = String(body.PaymentId);
	if (body.Status === "CONFIRMED" && body.Success) {
		await ingestAcquiringPayment({
			source: "tbank_acquiring",
			externalId: paymentId,
			orderId: body.OrderId,
			amountKopecks: body.Amount,
			paidAt: new Date(),
			purpose: `Эквайринг, заказ ${body.OrderId}`,
			raw: body,
		});
	} else if (body.Status === "REFUNDED") {
		await ingestAcquiringRefund(paymentId);
	} else if (body.Status === "PARTIAL_REFUNDED") {
		// Сумма частичного возврата в уведомлении неоднозначна — не гадаем,
		// оставляем на ручной разбор.
		console.error(
			`[payments] частичный возврат PaymentId=${paymentId} — требует ручного учёта`,
		);
	}
	return ok();
}
