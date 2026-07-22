import { resolveTelegramBotToken } from "@psi-opora/bot-core";
import { Bot } from "grammy";

const token = await resolveTelegramBotToken();

if (!token) {
  console.error(
    "Нужен токен бота в БД — введите его в настройках канала в Открытых линиях",
  );
  process.exit(1);
}

const bot = new Bot(token);

await bot.api.deleteWebhook({ drop_pending_updates: true });
const info = await bot.api.getWebhookInfo();
console.log("✓ Webhook удалён. Текущий статус:", info.url || "нет webhook");
