import { resolveTelegramBotToken } from "@psi-opora/bot-core";
import { Bot } from "grammy";

const token = await resolveTelegramBotToken();

if (!token) {
  console.error("Нужен TG_BOT_TOKEN (или сохранённый в БД токен) в .env");
  process.exit(1);
}

const bot = new Bot(token);

await bot.api.deleteWebhook({ drop_pending_updates: true });
const info = await bot.api.getWebhookInfo();
console.log("✓ Webhook удалён. Текущий статус:", info.url || "нет webhook");
