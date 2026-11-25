import { timingSafeEqual } from "node:crypto";
import { env } from "@psi-opora/config";
import { normalizeAccountOperations } from "./account-operations";
import { ingestAccountPayment } from "./ingest";

/**
 * Вебхук Т-Бизнеса «Операция по счету» (eventType oper-feed-operation) —
 * переводы клиентов на расчётный счёт. Подключается письмом на
 * openapi@tbank.ru; банк шлёт POST на HTTPS-URL с необязательной
 * Bearer-авторизацией. Тестового режима нет.
 * https://developer.tbank.ru/docs/products/account-info
 *
 * ВАЖНО: официальная схема тела в открытой документации не опубликована
 * («Схема вебхука»/«Пример» подгружаются отдельно), поэтому разбор терпим
 * к вариантам имён полей, а сырое тело сохраняется в payments.raw. Перед
 * боевым включением сверить с первым реальным событием.
 */

function authorized(request: Request, token: string): boolean {
	const expected = Buffer.from(`Bearer ${token}`);
	const actual = Buffer.from(request.headers.get("authorization") ?? "");
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function handleAccountWebhook(
	request: Request,
): Promise<Response> {
	const token = env.TBANK_ACCOUNT_WEBHOOK_TOKEN;
	if (!token) {
		console.error(
			"[payments] TBANK_ACCOUNT_WEBHOOK_TOKEN не задан — запрос отклонён",
		);
		return new Response("Not configured", { status: 500 });
	}
	if (!authorized(request, token)) {
		return new Response("Unauthorized", { status: 401 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return new Response("Bad Request", { status: 400 });
	}

	const { operations, skipped } = normalizeAccountOperations(body);
	for (const reason of skipped) {
		console.error(`[payments] операция по счёту пропущена: ${reason}`);
	}
	for (const op of operations) {
		const { externalId, ...rest } = op;
		await ingestAccountPayment({
			source: "tbank_account",
			externalId,
			...rest,
		});
	}
	return Response.json({ ok: true });
}
