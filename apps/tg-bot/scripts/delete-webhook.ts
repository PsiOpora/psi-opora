import { Bot } from "grammy";
import { env } from "@psi-opora/config";

const token = env.TG_BOT_TOKEN;

if (!token) {
  console.error("Нужен TG_BOT_TOKEN в .env");
  process.exit(1);
}

const bot = new Bot(token);

await bot.api.deleteWebhook({ drop_pending_updates: true });
const info = await bot.api.getWebhookInfo();
console.log("✓ Webhook удалён. Текущий статус:", info.url || "нет webhook");
