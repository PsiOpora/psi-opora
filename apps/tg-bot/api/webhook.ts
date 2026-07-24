import type { IncomingMessage, ServerResponse } from "node:http";
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
import { uploadTelegramAvatar, uploadTelegramMedia } from "../src/avatar-storage.js";

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
  uploadMedia: uploadTelegramMedia,
});
const handleUpdate = webhookCallback(bot, "http");

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method === "GET") {
    res.end("ok");
    return;
  }
  await handleUpdate(req, res);
}
