import "dotenv/config";
import { appendFileSync } from "fs";
import { resolve } from "path";
import { createBot, log as baseLog } from "./bot.js";

// В dev-режиме дополнительно пишем в файл
const logPath = resolve("bot.log");
const log = (msg: string) => {
  baseLog(msg);
  appendFileSync(logPath, `${new Date().toISOString()} ${msg}\n`);
};

const bot = createBot();

bot.start({
  onStart: () => log("[BOT] Запущен. Polling..."),
});
