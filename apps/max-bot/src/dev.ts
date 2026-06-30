import "dotenv/config";
import { appendFileSync } from "fs";
import { resolve } from "path";
import { createBot, log as baseLog } from "@psi-opora/bot-core";

const MAX_API_ROOT = "https://botapi.max.ru";

const logPath = resolve("bot.log");
const log = (msg: string) => {
  baseLog(msg);
  appendFileSync(logPath, `${new Date().toISOString()} ${msg}\n`);
};

const bot = createBot({ apiRoot: MAX_API_ROOT, messenger: "max" });

bot.start({
  onStart: () => log("[BOT] max-bot запущен. Polling..."),
});
