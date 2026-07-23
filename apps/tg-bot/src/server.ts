import { serve } from "@hono/node-server";
import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import {
  type ConsultationSession,
  createBot,
  createRedisStorage,
  createUpstashRedis,
  resolveTelegramBotToken,
} from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import { webhookCallback } from "grammy";
import { Hono } from "hono";
import { uploadTelegramAvatar } from "./avatar-storage.js";

const redis = createUpstashRedis();
const storage = createRedisStorage<ConsultationSession>(redis);
// resolveBitrixApi(undefined) откатывается на DASHBOARD_BITRIX_WEBHOOK_URL,
// который для imconnector.* не подходит (нужен OAuth) — поэтому передаём
// bitrixApi только когда BITRIX_MEMBER_ID реально задан.
const bitrixApi = env.BITRIX_MEMBER_ID
  ? resolveBitrixApi(env.BITRIX_MEMBER_ID)
  : undefined;
const token = await resolveTelegramBotToken();
const bot = createBot({
  storage,
  redis,
  bitrixApi: bitrixApi ?? undefined,
  token,
  uploadAvatar: uploadTelegramAvatar,
});

const app = new Hono();
app.get("/api/webhook", (c) => c.text("ok"));
app.post("/api/webhook", webhookCallback(bot, "hono"));

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[BOT] tg-bot webhook слушает на :${info.port}`);
});
