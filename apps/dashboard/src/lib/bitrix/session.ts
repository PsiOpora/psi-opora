import { cookies } from "next/headers";
import { createOAuthApi, createWebhookApi, type BitrixApi } from "./client";
import { getPortalTokens } from "./tokens";

export const MEMBER_ID_COOKIE = "b24_member_id";

/**
 * Возвращает REST-клиент для текущего запроса: сначала пробуем OAuth-сессию
 * портала (установлено приложение в Битрикс24), иначе — вебхук для локальной
 * разработки (DASHBOARD_BITRIX_WEBHOOK_URL в .env).
 */
export async function getBitrixApi(): Promise<BitrixApi | null> {
  const store = await cookies();
  const memberId = store.get(MEMBER_ID_COOKIE)?.value;

  if (memberId) {
    const tokens = await getPortalTokens(memberId);
    if (tokens) return createOAuthApi(memberId);
  }

  const devWebhook = process.env.DASHBOARD_BITRIX_WEBHOOK_URL;
  if (devWebhook) return createWebhookApi(devWebhook);

  return null;
}
