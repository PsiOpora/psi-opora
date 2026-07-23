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

const res = await fetch(
  `${MAX_API_ROOT}/subscriptions?url=${encodeURIComponent(webhookEndpoint)}`,
  {
    method: "DELETE",
    headers: {
      Authorization: token,
    },
  },
);

if (res.status === 204 || res.status === 200) {
  console.log("✓ MAX webhook удалён");
} else {
  const json = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  console.error(`Ошибка ${res.status}:`, JSON.stringify(json, null, 2));
  process.exit(1);
}
