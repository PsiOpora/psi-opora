import { createMaxBot } from "./bot";

const bot = createMaxBot();

bot.botInfo = await bot.api.getMyInfo();
console.log(`[BOT] max-bot запущен: @${bot.botInfo.username}. Polling...`);
await bot.start();
