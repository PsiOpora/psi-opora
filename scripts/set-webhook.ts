import "dotenv/config";
import { Bot } from "grammy";

const token = process.env.BOT_TOKEN;
const webhookUrl = process.env.WEBHOOK_URL;

if (!token || !webhookUrl) {
  console.error("Нужны BOT_TOKEN и WEBHOOK_URL в .env");
  process.exit(1);
}

const bot = new Bot(token);
const url = `${webhookUrl.replace(/\/$/, "")}/api/webhook`;

await bot.api.setWebhook(url, { drop_pending_updates: true });
const info = await bot.api.getWebhookInfo();

console.log("✓ Webhook установлен:", info.url);
console.log("  Pending updates:", info.pending_update_count);
