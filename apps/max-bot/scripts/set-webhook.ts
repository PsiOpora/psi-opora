import { resolveMaxBotToken } from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";

const token = await resolveMaxBotToken();
const webhookUrl = env.MAX_WEBHOOK_URL;
const MAX_API_ROOT = "https://platform-api2.max.ru";

if (!token || !webhookUrl) {
  console.error(
    "Нужен токен бота в БД (введите его в настройках канала в Открытых линиях) и MAX_WEBHOOK_URL в .env",
  );
  process.exit(1);
}

const webhookEndpoint = `${webhookUrl.replace(/\/$/, "")}`;

const res = await fetch(`${MAX_API_ROOT}/subscriptions`, {
  method: "POST",
  headers: {
    Authorization: token,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ url: webhookEndpoint }),
});

const json = (await res.json()) as Record<string, unknown>;

if (!res.ok) {
  console.error("Ошибка:", JSON.stringify(json, null, 2));
  process.exit(1);
}

console.log("✓ MAX webhook установлен:", webhookEndpoint);
console.log("Ответ:", JSON.stringify(json, null, 2));
