import { serve } from "@hono/node-server";
import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import {
	type ConsultationSession,
	createBot,
	createRedisClient,
	createRedisStorage,
	resolveTelegramBotToken,
	warmScenarioTexts,
} from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import { webhookCallback } from "grammy";
import { Hono } from "hono";
import { uploadTelegramAvatar, uploadTelegramMedia } from "./avatar-storage";

const redis = createRedisClient();
const storage = createRedisStorage<ConsultationSession>(redis);
// resolveBitrixApi(undefined) откатывается на DASHBOARD_BITRIX_WEBHOOK_URL,
// который для imconnector.* не подходит (нужен OAuth) — поэтому передаём
// bitrixApi только когда BITRIX_MEMBER_ID реально задан.
const bitrixApi = env.BITRIX_MEMBER_ID
	? resolveBitrixApi(env.BITRIX_MEMBER_ID)
	: undefined;
const token = await resolveTelegramBotToken();
// Не ждём: первый /start подхватит уже идущую загрузку, а не начнёт свою.
void warmScenarioTexts();
const bot = createBot({
	storage,
	redis,
	bitrixApi: bitrixApi ?? undefined,
	token,
	uploadAvatar: uploadTelegramAvatar,
	uploadMedia: uploadTelegramMedia,
});

const app = new Hono();
app.get("/api/webhook", (c) => c.text("ok"));
// onTimeout: "return" — если обработка апдейта (голосовые/файлы: getFile +
// пересылка в Открытую линию Bitrix) не укладывается в timeoutMilliseconds,
// Telegram получает пустой 200 сразу, а не падает с необработанным reject
// (дефолт grammy — "throw"), который валит процесс и вызывает ретраи от
// Telegram. Обработка апдейта при этом продолжается в фоне — see webhook.js.
app.post(
	"/api/webhook",
	webhookCallback(bot, "hono", {
		onTimeout: "return",
		timeoutMilliseconds: 15_000,
	}),
);

const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, port }, (info) => {
	console.log(`[BOT] tg-bot webhook слушает на :${info.port}`);
});

// При rollout k8s шлёт SIGTERM до SIGKILL — дожидаемся завершения активных
// запросов вместо мгновенного обрыва соединений.
process.on("SIGTERM", () => {
	server.close(() => process.exit(0));
});
