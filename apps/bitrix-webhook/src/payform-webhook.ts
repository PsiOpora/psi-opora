import {
	appendDealComment,
	getScenarioTexts,
	moveBookPreorderDealStage,
	verifyProdamusSignature,
} from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import { markBookPreorderPaid } from "@psi-opora/db/queries";
import { type Messenger, sendMessengerMessage } from "@psi-opora/jobs";

/**
 * Вебхук об оплате предзаказа книги «Тело берёт своё» — payform.ru на белом
 * лейбле Prodamus. Prodamus шлёт `application/x-www-form-urlencoded` с
 * `order_id`/`payment_status`/... и подписью в заголовке `Sign`.
 *
 * ВАЖНО: перед тем как полагаться на это в проде, нужно сверить реальный
 * тестовый платёж и логи — см. допущение 2 в плане реализации сценария.
 */

/** Разбирает form-urlencoded тело с PHP-style вложенностью (`products[0][price]`)
 * в обычный объект — так же, как это видит Prodamus при формировании подписи. */
function parseFormFields(raw: string): Record<string, unknown> {
	const params = new URLSearchParams(raw);
	const root: Record<string, unknown> = {};
	for (const [rawKey, value] of params.entries()) {
		const path = rawKey.replace(/\]/g, "").split("[").filter(Boolean);
		if (path.length === 0) continue;
		let node = root;
		for (let i = 0; i < path.length - 1; i++) {
			const segment = path[i] as string;
			const child = node[segment];
			if (typeof child !== "object" || child === null) {
				node[segment] = {};
			}
			node = node[segment] as Record<string, unknown>;
		}
		node[path[path.length - 1] as string] = value;
	}
	return root;
}

export async function handlePayformWebhook(
	request: Request,
): Promise<Response> {
	const secret = env.PRODAMUS_SECRET_KEY;
	if (!secret) {
		console.error(
			"[payform-webhook] PRODAMUS_SECRET_KEY не задан — запрос отклонён",
		);
		return new Response("Not configured", { status: 500 });
	}

	const rawBody = await request.text();
	const fields = parseFormFields(rawBody);
	const {
		sign,
		signature: _signature,
		...fieldsToVerify
	} = fields as Record<string, unknown>;

	if (
		!verifyProdamusSignature(
			fieldsToVerify,
			request.headers.get("sign") ?? (typeof sign === "string" ? sign : null),
			secret,
		)
	) {
		console.warn("[payform-webhook] неверная подпись — запрос отброшен");
		return new Response("Unauthorized", { status: 401 });
	}

	const orderNo = Number(fields.order_id);
	const paymentStatus = String(fields.payment_status ?? "").toLowerCase();
	if (!Number.isFinite(orderNo) || paymentStatus !== "success") {
		// Не успешный платёж (отмена, ожидание) или чужое событие — подтверждаем
		// приём без действий, повторно Prodamus не шлёт.
		return Response.json({ ok: true });
	}

	// Идемпотентность: markBookPreorderPaid обновляет только заказы в статусе
	// "awaiting_payment" — повторный вебхук по уже оплаченному заказу вернёт
	// null и просьба клиенту про адрес не уйдёт дважды.
	const order = await markBookPreorderPaid(orderNo);
	if (!order) return Response.json({ ok: true });

	const messenger = order.messenger as Messenger;
	const texts = await getScenarioTexts();
	const text = texts.bp_paid_reply.replaceAll("{номер}", String(order.orderNo));
	try {
		await sendMessengerMessage(messenger, order.userId, text);
	} catch (err) {
		console.error(
			`[payform-webhook] не удалось отправить подтверждение оплаты order=${order.id}: ${(err as Error).message}`,
		);
	}

	if (order.dealId) {
		await moveBookPreorderDealStage(messenger, order.dealId, "paid");
		await appendDealComment(
			messenger,
			order.dealId,
			`💰 Оплата получена (Prodamus), заказ №${order.orderNo}.`,
		);
	}

	return Response.json({ ok: true });
}
