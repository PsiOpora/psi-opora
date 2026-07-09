import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { log as baseLog, createBot } from "@psi-opora/bot-core";

const logPath = resolve("bot.log");
const log = (msg: string) => {
  baseLog(msg);
  appendFileSync(logPath, `${new Date().toISOString()} ${msg}\n`);
};

const bot = createBot({
  client: process.env.TG_BOT_PROXY ? { apiRoot: process.env.TG_BOT_PROXY } : undefined,
});

bot.start({
  onStart: () => log("[BOT] tg-bot запущен. Polling..."),
});
