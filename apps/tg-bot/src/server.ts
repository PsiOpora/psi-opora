import { serve } from "@hono/node-server";
import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import {
	type ConsultationSession,
	createBot,
	createBotBackgroundQueue,
	createRedisClient,
	createRedisStorage,
	resolveTelegramBotToken,
	warmScenarioTexts,
} from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import {
	enqueueBotBackgroundTask,
	isHatchetConfigured,
} from "@psi-opora/jobs/bot-background";
import { flushTelemetry, initTelemetry } from "@psi-opora/telemetry";
import { Hono } from "hono";
import { uploadTelegramAvatar, uploadTelegramMedia } from "./avatar-storage";
import { startPolling } from "./polling";

initTelemetry("tg-bot");

const redis = createRedisClient();
const storage = createRedisStorage<ConsultationSession>(redis);
// resolveBitrixApi(undefined) откатывается на DASHBOARD_BITRIX_WEBHOOK_URL,
// который для imconnector.* не подходит (нужен OAuth) — поэтому передаём
// bitrixApi только когда BITRIX_MEMBER_ID реально задан.
const bitrixApi = env.BITRIX_MEMBER_ID
	? resolveBitrixApi(env.BITRIX_MEMBER_ID)
	: undefined;
const token = await resolveTelegramBotToken();
if (!token) {
	// Без токена long polling не запустить. Падаем, чтобы k8s перезапускал
	// под, пока администратор не введёт токен в настройках канала.
	console.error(
		"[BOT] Токен Telegram-бота не задан в БД — введите его в настройках канала в Открытых линиях",
	);
	await flushTelemetry();
	process.exit(1);
}
// Не ждём: первый /start подхватит уже идущую загрузку, а не начнёт свою.
void warmScenarioTexts();
// Открытая линия, обогащение CRM и триаж — в фоне, ответ клиенту их не ждёт;
// без Hatchet (локальная разработка) задачи выполняются прямо в процессе.
const background = createBotBackgroundQueue({
	bitrixApi: bitrixApi ?? undefined,
	enqueue: isHatchetConfigured() ? enqueueBotBackgroundTask : undefined,
});
const bot = createBot({
	background,
	storage,
	redis,
	bitrixApi: bitrixApi ?? undefined,
	token,
	uploadAvatar: uploadTelegramAvatar,
	uploadMedia: uploadTelegramMedia,
});

// Апдейты бот забирает сам (long polling, см. polling.ts) — HTTP-сервер
// остался только для health-check'ов k8s. GET /api/webhook — прежний адрес
// проверки, оставлен, чтобы не трогать пробы в манифестах.
const app = new Hono();
app.get("/healthz", (c) => c.text("ok"));
app.get("/api/webhook", (c) => c.text("ok"));

const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, port }, (info) => {
	console.log(`[BOT] tg-bot health-check слушает на :${info.port}`);
});

const polling = await startPolling(bot, redis);
console.log(
	`[BOT] tg-bot @${bot.botInfo.username} запущен в режиме long polling`,
);
polling.task.catch((err) => {
	// Сюда доходят только неисправимые ошибки (401 — токен отозван), остальные
	// polling.ts ретраит сам. Перезапуск пода перечитает токен из БД.
	console.error("[BOT] long polling остановлен:", err);
	void flushTelemetry().finally(() => process.exit(1));
});

// Страховка: необработанный reject валит процесс (Bun/Node >=15). Ошибки
// апдейтов ловит самый внешний middleware в createBot, но фоновые хвосты
// не должны ронять бота из-за одной ошибки.
process.on("unhandledRejection", (reason) => {
	console.error("[BOT] unhandledRejection:", reason);
});

// При rollout k8s шлёт SIGTERM до SIGKILL — перестаём забирать апдейты и
// дорабатываем уже полученные вместо мгновенного обрыва.
process.on("SIGTERM", async () => {
	await polling.stop(10_000);
	// Не теряем фоновые задачи, уже принятые от мессенджера.
	await background.drain(10_000);
	server.close();
	await flushTelemetry();
	process.exit(0);
});
