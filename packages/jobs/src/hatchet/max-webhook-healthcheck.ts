import { CreateTaskWorkflow } from "@hatchet-dev/typescript-sdk/v1";
import { resolveMaxBotToken } from "@psi-opora/bot-core";
import { RUSSIAN_TRUSTED_ROOT_CA } from "../certs/russian-trusted-ca";
import { fetchWithCa } from "../fetch-with-ca";

const MAX_API_ROOT = "https://platform-api2.max.ru";

interface MaxSubscription {
  url: string;
}

interface MaxSubscriptionsResponse {
  subscriptions?: MaxSubscription[];
}

/**
 * MAX может сам сбросить активную webhook-подписку (например, при сетевых
 * проблемах на прод-URL). Раз в 2 часа проверяем, что подписка жива,
 * и восстанавливаем её, если платформа её сбросила.
 */
export const maxWebhookHealthcheck = CreateTaskWorkflow({
  name: "max-webhook-healthcheck",
  on: { cron: "0 */2 * * *" },
  retries: 0,
  executionTimeout: "5m",
  fn: async () => {
    const token = await resolveMaxBotToken();
    const webhookUrl = process.env.MAX_WEBHOOK_URL;
    if (!token || !webhookUrl) {
      throw new Error(
        "Токен MAX-бота не задан в БД (введите его в настройках канала) или не задан MAX_WEBHOOK_URL",
      );
    }
    const webhookEndpoint = `${webhookUrl.replace(/\/$/, "")}`;

    const listRes = await fetchWithCa(
      new URL(`${MAX_API_ROOT}/subscriptions`),
      { headers: { Authorization: token } },
      RUSSIAN_TRUSTED_ROOT_CA,
    );
    if (!listRes.ok) {
      throw new Error(`MAX GET /subscriptions HTTP ${listRes.status}`);
    }
    const json = (await listRes.json()) as MaxSubscriptionsResponse;
    const isActive =
      json.subscriptions?.some((s) => s.url === webhookEndpoint) ?? false;
    if (isActive) return { restored: false };

    const setRes = await fetchWithCa(
      new URL(`${MAX_API_ROOT}/subscriptions`),
      {
        method: "POST",
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify({ url: webhookEndpoint }),
      },
      RUSSIAN_TRUSTED_ROOT_CA,
    );
    if (!setRes.ok) {
      const errJson = await setRes.json().catch(() => null);
      throw new Error(
        `MAX POST /subscriptions HTTP ${setRes.status}: ${JSON.stringify(errJson)}`,
      );
    }

    return { restored: true, url: webhookEndpoint };
  },
});
