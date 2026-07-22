import { resolveTelegramBotToken } from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import { Bot } from "grammy";

const token = await resolveTelegramBotToken();
const webhookUrl = env.TG_WEBHOOK_URL;

if (!token || !webhookUrl) {
  console.error("Нужны TG_BOT_TOKEN (или сохранённый в БД токен) и TG_WEBHOOK_URL в .env");
  process.exit(1);
}

const bot = new Bot(token);
const url = `${webhookUrl.replace(/\/$/, "")}/api/webhook`;

await bot.api.setWebhook(url, { drop_pending_updates: true });
const info = await bot.api.getWebhookInfo();
console.log("✓ Telegram webhook:", info.url);
