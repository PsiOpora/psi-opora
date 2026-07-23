import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import { log as baseLog, createBot } from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import { uploadTelegramAvatar } from "./avatar-storage.js";

const logPath = resolve("bot.log");
const log = (msg: string) => {
  baseLog(msg);
  appendFileSync(logPath, `${new Date().toISOString()} ${msg}\n`);
};

const bitrixApi = env.BITRIX_MEMBER_ID
  ? resolveBitrixApi(env.BITRIX_MEMBER_ID)
  : undefined;
const bot = createBot({
  client: process.env.TG_BOT_PROXY
    ? { apiRoot: process.env.TG_BOT_PROXY }
    : undefined,
  bitrixApi: bitrixApi ?? undefined,
  uploadAvatar: uploadTelegramAvatar,
});

bot.start({
  onStart: () => log("[BOT] tg-bot запущен. Polling..."),
});
