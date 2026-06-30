import "dotenv/config";
import { Bot } from "grammy";

const token = process.env.MAX_BOT_TOKEN;
const webhookUrl = process.env.MAX_WEBHOOK_URL;
const MAX_API_ROOT = "https://botapi.max.ru";

if (!token || !webhookUrl) {
  console.error("Нужны MAX_BOT_TOKEN и MAX_WEBHOOK_URL в .env");
  process.exit(1);
}

const bot = new Bot(token, { client: { apiRoot: MAX_API_ROOT } });
const url = `${webhookUrl.replace(/\/$/, "")}/api/webhook`;

await bot.api.setWebhook(url, { drop_pending_updates: true });
const info = await bot.api.getWebhookInfo();
console.log("✓ MAX webhook:", info.url);
