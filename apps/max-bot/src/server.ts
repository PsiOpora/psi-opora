import { serve } from "@hono/node-server";
import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import {
	type ConsultationSession,
	createRedisClient,
	createRedisStorage,
	resolveMaxBotToken,
} from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import { Hono } from "hono";
import { createMaxBot, processUpdate } from "./bot.js";

const redis = createRedisClient();
const storage = createRedisStorage<ConsultationSession>(redis);
// resolveBitrixApi(undefined) откатывается на DASHBOARD_BITRIX_WEBHOOK_URL,
// который для imconnector.* не подходит (нужен OAuth) — поэтому передаём
// bitrixApi только когда BITRIX_MEMBER_ID реально задан.
const bitrixApi = env.BITRIX_MEMBER_ID
	? resolveBitrixApi(env.BITRIX_MEMBER_ID)
	: undefined;
const token = await resolveMaxBotToken();
const bot = createMaxBot({
	storage,
	redis,
	bitrixApi: bitrixApi ?? undefined,
	token,
});

const app = new Hono();
// Заглушка для webapp-кнопки бота в MAX — сама кнопка настроена вне этого
// репозитория (в самом MAX), а её URL мог указывать сюда без реального
// контента за ним. Отдаём простую страницу вместо 404.
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
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #fafafa;
    color: #333;
    text-align: center;
    padding: 24px;
    box-sizing: border-box;
  }
  p { max-width: 320px; line-height: 1.5; }
</style>
</head>
<body>
<p>Раздел пока недоступен.<br/>Загляните позже.</p>
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
	server.close(() => process.exit(0));
});
