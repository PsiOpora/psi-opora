import { Bot } from "grammy";

const token = process.env.TG_BOT_TOKEN;
const webhookUrl = process.env.TG_WEBHOOK_URL;

if (!token || !webhookUrl) {
  console.error("Нужны TG_BOT_TOKEN и TG_WEBHOOK_URL в .env");
  process.exit(1);
}

const bot = new Bot(token);
const url = `${webhookUrl.replace(/\/$/, "")}/api/webhook`;

await bot.api.setWebhook(url, { drop_pending_updates: true });
const info = await bot.api.getWebhookInfo();
console.log("✓ Telegram webhook:", info.url);
