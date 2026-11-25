import { env } from "@psi-opora/config";
import type { Purchase } from "@psi-opora/db/queries";
import { z } from "zod";
import { computeTbankToken } from "./tbank-token";

/**
 * Создание платежа в эквайринге Т-Банка (Init) для покупки: OrderId = id
 * покупки, поэтому уведомление об оплате привязывается к ней однозначно.
 * https://developer.tbank.ru/eacq/api/init
 */

const INIT_URL = "https://securepay.tinkoff.ru/v2/Init";

const initResponseSchema = z
	.object({
		Success: z.boolean(),
		PaymentURL: z.string().optional(),
		PaymentId: z.union([z.string(), z.number()]).optional(),
		ErrorCode: z.string().optional(),
		Message: z.string().optional(),
		Details: z.string().optional(),
	})
	.passthrough();

export async function createPaymentLink(
	purchase: Purchase,
): Promise<{ paymentUrl: string; paymentId: string }> {
	const terminalKey = env.TBANK_TERMINAL_KEY;
	const password = env.TBANK_TERMINAL_PASSWORD;
	if (!terminalKey || !password) {
		throw new Error("TBANK_TERMINAL_KEY / TBANK_TERMINAL_PASSWORD не заданы");
	}

	const params: Record<string, string | number> = {
		TerminalKey: terminalKey,
		Amount: purchase.amountKopecks,
		OrderId: purchase.id,
		Description: purchase.title.slice(0, 140),
	};
	if (env.PAYMENTS_PUBLIC_URL) {
		params.NotificationURL = `${env.PAYMENTS_PUBLIC_URL.replace(/\/$/, "")}/api/tbank/acquiring`;
	}
	const body = { ...params, Token: computeTbankToken(params, password) };

	const res = await fetch(INIT_URL, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	const parsed = initResponseSchema.safeParse(await res.json());
	if (!parsed.success || !parsed.data.Success || !parsed.data.PaymentURL) {
		const detail = parsed.success
			? `${parsed.data.ErrorCode ?? ""} ${parsed.data.Message ?? ""} ${parsed.data.Details ?? ""}`
			: "неожиданный ответ";
		throw new Error(`Т-Банк Init: ${detail.trim()}`);
	}
	return {
		paymentUrl: parsed.data.PaymentURL,
		paymentId: String(parsed.data.PaymentId ?? ""),
	};
}
