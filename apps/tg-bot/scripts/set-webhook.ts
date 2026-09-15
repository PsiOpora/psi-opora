import {
	createTelegramFetch,
	resolveTelegramApiRoot,
	resolveTelegramBotToken,
} from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import { Bot } from "grammy";

const token = await resolveTelegramBotToken();
const webhookUrl = env.TG_WEBHOOK_URL;

if (!token || !webhookUrl) {
	console.error(
		"Нужен токен бота в БД (введите его в настройках канала в Открытых линиях) и TG_WEBHOOK_URL в .env",
	);
	process.exit(1);
}

const bot = new Bot(token, {
	client: { apiRoot: resolveTelegramApiRoot(), fetch: createTelegramFetch() },
});
const url = `${webhookUrl.replace(/\/$/, "")}`;

await bot.api.setWebhook(url, {
	drop_pending_updates: true,
	// Telegram присылает его обратно в X-Telegram-Bot-Api-Secret-Token на
	// каждом вебхуке — без этого /webhook на apps/tg-vercel-proxy принял бы
	// запрос от кого угодно, кто узнает URL (см. TG_WEBHOOK_SECRET).
	...(env.TG_WEBHOOK_SECRET ? { secret_token: env.TG_WEBHOOK_SECRET } : {}),
});
const info = await bot.api.getWebhookInfo();
console.log("✓ Telegram webhook:", info.url);
