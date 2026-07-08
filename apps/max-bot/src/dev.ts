import "dotenv/config";
import { appendFileSync } from "fs";
import { resolve } from "path";
import { createMaxBot, log as baseLog } from "./bot";

const logPath = resolve("bot.log");
const log = (msg: string) => {
  baseLog(msg);
  appendFileSync(logPath, `${new Date().toISOString()} ${msg}\n`);
};

const bot = createMaxBot();

bot.botInfo = await bot.api.getMyInfo();
log(`[BOT] max-bot запущен: @${bot.botInfo.username}. Polling...`);
await bot.start();
