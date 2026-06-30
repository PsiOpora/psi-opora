import "dotenv/config";
import { appendFileSync } from "fs";
import { resolve } from "path";
import { createBot, log as baseLog } from "@psi-opora/bot-core";

const logPath = resolve("bot.log");
const log = (msg: string) => {
  baseLog(msg);
  appendFileSync(logPath, `${new Date().toISOString()} ${msg}\n`);
};

const bot = createBot({ messenger: "telegram" });

bot.start({
  onStart: () => log("[BOT] tg-bot запущен. Polling..."),
});
