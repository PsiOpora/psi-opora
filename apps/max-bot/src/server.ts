import { serve } from "@hono/node-server";
import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import {
  type ConsultationSession,
  createRedisStorage,
  createUpstashRedis,
  resolveMaxBotToken,
} from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import { Hono } from "hono";
import { createMaxBot, processUpdate } from "./bot.js";

const redis = createUpstashRedis();
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
app.get("/api/webhook", (c) => c.text("ok"));
app.post("/api/webhook", async (c) => {
  const body = await c.req.json();
  await processUpdate(bot, body);
  return c.text("ok");
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[BOT] max-bot webhook слушает на :${info.port}`);
});
