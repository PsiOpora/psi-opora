import { Bot } from "grammy";
import { env } from "@psi-opora/config";

const token = env.TG_BOT_TOKEN;
const webhookUrl = env.TG_WEBHOOK_URL;

if (!token || !webhookUrl) {
  console.error("Нужны TG_BOT_TOKEN и TG_WEBHOOK_URL в .env");
  process.exit(1);
}

const bot = new Bot(token);
const url = `${webhookUrl.replace(/\/$/, "")}/api/webhook`;

await bot.api.setWebhook(url, { drop_pending_updates: true });
const info = await bot.api.getWebhookInfo();
console.log("✓ Telegram webhook:", info.url);
