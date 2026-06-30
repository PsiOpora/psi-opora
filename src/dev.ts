import "dotenv/config";
import { createBot, log } from "./bot.js";

// Локальный запуск через polling (без Redis, сессии в памяти)
const bot = createBot();

bot.start({
  onStart: () => log("[BOT] Запущен. Polling..."),
});
