import { serve } from "@hono/node-server";
import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import {
	type ConsultationSession,
	createBotBackgroundQueue,
	createRedisClient,
	createRedisStorage,
	resolveMaxBotToken,
	warmScenarioTexts,
} from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import {
	enqueueBotBackgroundTask,
	isHatchetConfigured,
} from "@psi-opora/jobs/bot-background";
import { Hono } from "hono";
import { createMaxBot, processUpdate } from "./bot";
import { createWebAppRoutes } from "./webapp/routes";

const redis = createRedisClient();
const storage = createRedisStorage<ConsultationSession>(redis);
// resolveBitrixApi(undefined) откатывается на DASHBOARD_BITRIX_WEBHOOK_URL,
// который для imconnector.* не подходит (нужен OAuth) — поэтому передаём
// bitrixApi только когда BITRIX_MEMBER_ID реально задан.
const bitrixApi = env.BITRIX_MEMBER_ID
	? resolveBitrixApi(env.BITRIX_MEMBER_ID)
	: undefined;
const token = await resolveMaxBotToken();
// Не ждём: первый /start подхватит уже идущую загрузку, а не начнёт свою.
void warmScenarioTexts();
// Открытая линия, обогащение CRM и триаж — в фоне, ответ клиенту их не ждёт;
// без Hatchet (локальная разработка) задачи выполняются прямо в процессе.
const background = createBotBackgroundQueue({
	bitrixApi: bitrixApi ?? undefined,
	enqueue: isHatchetConfigured() ? enqueueBotBackgroundTask : undefined,
});
const bot = createMaxBot({
	background,
	storage,
	redis,
	bitrixApi: bitrixApi ?? undefined,
	token,
});

const app = new Hono();
// Мини-приложение для кнопки «Открыть» в чате с ботом (URL задаётся в
// business.max.ru — см. docs/max-mini-app.md).
app.route("/", createWebAppRoutes({ bot, token }));
app.get("/api/webhook", (c) => c.text("ok"));
app.post("/api/webhook", async (c) => {
	const body = await c.req.json();
	await processUpdate(bot, body);
	return c.text("ok");
});

const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, port }, (info) => {
	console.log(`[BOT] max-bot webhook слушает на :${info.port}`);
});

// При rollout k8s шлёт SIGTERM до SIGKILL — дожидаемся завершения активных
// запросов вместо мгновенного обрыва соединений.
process.on("SIGTERM", () => {
	server.close(async () => {
		// Не теряем фоновые задачи, уже принятые от мессенджера.
		await background.drain(10_000);
		process.exit(0);
	});
});
