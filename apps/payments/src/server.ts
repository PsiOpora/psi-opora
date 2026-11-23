import { serve } from "@hono/node-server";
import { listPaymentsPendingBitrixSync } from "@psi-opora/db/queries";
import { flushTelemetry, initTelemetry } from "@psi-opora/telemetry";
import { Hono } from "hono";
import { handleAccountWebhook } from "./account-webhook";
import { handleAcquiringWebhook } from "./acquiring-webhook";
import { adminApi } from "./admin-api";
import { processPayment } from "./process-payment";
import { ui } from "./ui";

initTelemetry("payments");

const app = new Hono();

app.get("/", (c) => c.json({ status: "ok", service: "payments" }));

// Т-Касса: уведомления о статусе платежа (подпись Token).
app.post("/api/tbank/acquiring", (c) => handleAcquiringWebhook(c.req.raw));
// Т-Бизнес: вебхук «Операция по счету» (Bearer-токен).
app.post("/api/tbank/account-operation", (c) =>
	handleAccountWebhook(c.req.raw),
);
app.route("/api/admin", adminApi);
// Экраны учёта (вход по токену): сводка, оплаты, клиенты, каталог, настройки.
app.route("/ui", ui);

/**
 * Повтор оплат, которые не удалось отразить в Bitrix (сбой REST, лимиты,
 * процесс упал после записи). Тикер в процессе, а не cron Hatchet — у
 * Hatchet Cloud суточный лимит запусков. Реплика ровно одна.
 */
const RETRY_INTERVAL_MS = 2 * 60 * 1000;
let retrying = false;
async function retryPendingPayments(): Promise<void> {
	if (retrying) return;
	retrying = true;
	try {
		for (const payment of await listPaymentsPendingBitrixSync(50)) {
			try {
				await processPayment(payment);
			} catch (err) {
				console.error(
					`[payments] повтор оплаты ${payment.id} не удался: ${(err as Error).message}`,
				);
			}
		}
	} finally {
		retrying = false;
	}
}
const retryTimer = setInterval(() => {
	void retryPendingPayments();
}, RETRY_INTERVAL_MS);

const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, port }, (info) => {
	console.log(`[payments] слушает на :${info.port}`);
});

process.on("SIGTERM", () => {
	clearInterval(retryTimer);
	server.close(async () => {
		await flushTelemetry();
		process.exit(0);
	});
});
