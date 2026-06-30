import "dotenv/config";

const token = process.env.MAX_BOT_TOKEN;
const webhookUrl = process.env.MAX_WEBHOOK_URL;
const MAX_API_ROOT = "https://botapi.max.ru";

if (!token || !webhookUrl) {
  console.error("Нужны MAX_BOT_TOKEN и MAX_WEBHOOK_URL в .env");
  process.exit(1);
}

const webhookEndpoint = `${webhookUrl.replace(/\/$/, "")}/api/webhook`;

const res = await fetch(`${MAX_API_ROOT}/subscriptions`, {
  method: "POST",
  headers: {
    "Authorization": token,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ url: webhookEndpoint }),
});

const json = await res.json() as any;

if (!res.ok) {
  console.error("Ошибка:", JSON.stringify(json, null, 2));
  process.exit(1);
}

console.log("✓ MAX webhook установлен:", webhookEndpoint);
console.log("Ответ:", JSON.stringify(json, null, 2));
