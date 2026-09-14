import {
	appendDealComment,
	getScenarioTexts,
	verifyProdamusSignature,
} from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import {
	claimBookPreorderDealPaidSync,
	claimBookPreorderPaidNotification,
	getBookPreorderOrderByOrderNo,
	markBookPreorderPaid,
	releaseBookPreorderDealPaidSync,
	releaseBookPreorderPaidNotification,
} from "@psi-opora/db/queries";
import { type Messenger, sendMessengerMessage } from "@psi-opora/jobs";
import { z } from "zod";

/**
 * Вебхук об оплате предзаказа книги «Тело берёт своё» — payform.ru на белом
 * лейбле Prodamus. Prodamus шлёт `application/x-www-form-urlencoded` с
 * `order_id`/`payment_status`/... и подписью в заголовке `Sign`.
 *
 * ВАЖНО: перед тем как полагаться на это в проде, нужно сверить реальный
 * тестовый платёж и логи — см. допущение 2 в плане реализации сценария.
 */

/** Ключи, которые нельзя пускать в путь параметра — иначе `node[segment] = {}`
 * на объекте с обычным прототипом дотягивается до Object.prototype
 * (`__proto__`) или его конструктора ещё до проверки подписи вебхука. */
const UNSAFE_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

const payformWebhookSchema = z
	.object({
		order_id: z.string(),
		payment_status: z.string(),
		sign: z.string().optional(),
		signature: z.string().optional(),
	})
	.passthrough();

/** Разбирает form-urlencoded тело с PHP-style вложенностью (`products[0][price]`)
 * в обычный объект — так же, как это видит Prodamus при формировании подписи.
 * Объекты без прототипа (Object.create(null)) — дополнительный барьер на
 * случай, если сегмент пути всё же похож на `__proto__`. */
function parseFormFields(raw: string): Record<string, unknown> {
	const params = new URLSearchParams(raw);
	const root: Record<string, unknown> = Object.create(null);
	for (const [rawKey, value] of params.entries()) {
		const path = rawKey.replace(/\]/g, "").split("[").filter(Boolean);
		if (path.length === 0) continue;
		if (path.some((segment) => UNSAFE_PATH_SEGMENTS.has(segment))) continue;
		let node = root;
		for (let i = 0; i < path.length - 1; i++) {
			const segment = path[i] as string;
			const child = node[segment];
			if (typeof child !== "object" || child === null) {
				node[segment] = Object.create(null);
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
	const parsedFields = payformWebhookSchema.safeParse(parseFormFields(rawBody));
	if (!parsedFields.success) {
		console.warn("[payform-webhook] некорректное тело запроса");
		return new Response("Bad Request", { status: 400 });
	}
	const fields = parsedFields.data;
	// Prodamus, по разным интеграциям, кладёт подпись то в заголовок Sign, то
	// в поле тела `sign`/`signature` — оба поля исключаем из подписываемых
	// данных независимо от того, какое реально пришло.
	const { sign, signature, ...fieldsToVerify } = fields;
	const bodySignature =
		typeof sign === "string"
			? sign
			: typeof signature === "string"
				? signature
				: null;

	if (
		!verifyProdamusSignature(
			fieldsToVerify,
			request.headers.get("sign") ?? bodySignature,
			secret,
		)
	) {
		console.warn("[payform-webhook] неверная подпись — запрос отброшен");
		return new Response("Unauthorized", { status: 401 });
	}

	const orderNo = Number(fields.order_id);
	const paymentStatus = fields.payment_status.toLowerCase();
	if (!Number.isFinite(orderNo) || paymentStatus !== "success") {
		// Не успешный платёж (отмена, ожидание) или чужое событие — подтверждаем
		// приём без действий, повторно Prodamus не шлёт.
		return Response.json({ ok: true });
	}

	// markBookPreorderPaid переводит в paid только заказы в статусе
	// "awaiting_payment" и вернёт null на повторный вебхук по уже оплаченному
	// заказу — тогда договариваем недоделанные побочные операции по заказу,
	// найденному напрямую (см. ниже claim*/release*): статус "paid" не
	// обязан означать, что клиенту ушло уведомление или сделка обновилась.
	const order =
		(await markBookPreorderPaid(orderNo)) ??
		(await getBookPreorderOrderByOrderNo(orderNo));
	if (order?.status !== "paid") return Response.json({ ok: true });

	const messenger = order.messenger as Messenger;

	if (
		!order.paidNotifiedAt &&
		(await claimBookPreorderPaidNotification(order.id))
	) {
		try {
			const texts = await getScenarioTexts();
			const text = texts.bp_paid_reply.replaceAll(
				"{номер}",
				String(order.orderNo),
			);
			await sendMessengerMessage(messenger, order.userId, text);
		} catch (err) {
			console.error(
				`[payform-webhook] не удалось отправить подтверждение оплаты order=${order.id}: ${(err as Error).message}`,
			);
			await releaseBookPreorderPaidNotification(order.id);
		}
	}

	if (
		order.dealId &&
		!order.dealPaidSyncedAt &&
		(await claimBookPreorderDealPaidSync(order.id))
	) {
		try {
			await appendDealComment(
				messenger,
				order.dealId,
				`💰 Оплата получена (Prodamus), заказ №${order.orderNo}.`,
			);
		} catch (err) {
			console.error(
				`[payform-webhook] не удалось прокомментировать сделку Bitrix order=${order.id}: ${(err as Error).message}`,
			);
			await releaseBookPreorderDealPaidSync(order.id);
		}
	}

	return Response.json({ ok: true });
}
