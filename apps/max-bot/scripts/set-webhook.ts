import { env } from "@psi-opora/config";

const token = env.MAX_BOT_TOKEN;
const webhookUrl = env.MAX_WEBHOOK_URL;
const MAX_API_ROOT = "https://platform-api2.max.ru";

if (!token || !webhookUrl) {
  console.error("Нужны MAX_BOT_TOKEN и MAX_WEBHOOK_URL в .env");
  process.exit(1);
}

const webhookEndpoint = `${webhookUrl.replace(/\/$/, "")}/api/webhook`;

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
