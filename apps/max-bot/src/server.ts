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
// Лендинг для webapp-кнопки бота в MAX (кнопка «Открыть» настроена вне
// этого репозитория, в самом MAX, и указывает на этот адрес).
app.get("/", (c) =>
	c.html(`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Опора</title>
<style>
  html, body {
    height: 100%;
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #fafafa;
    color: #222;
  }
  body {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    box-sizing: border-box;
  }
  .card {
    max-width: 360px;
    text-align: center;
  }
  h1 {
    margin: 0 0 12px;
    font-size: 28px;
    letter-spacing: 0.02em;
  }
  p {
    margin: 0;
    line-height: 1.5;
    color: #555;
  }
</style>
</head>
<body>
<div class="card">
  <h1>Опора</h1>
  <p>Спасибо, что заглянули. Все вопросы и запись — прямо в чате с ботом.</p>
</div>
</body>
</html>`),
);
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
