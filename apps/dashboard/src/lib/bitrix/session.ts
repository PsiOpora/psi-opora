import { cookies } from "next/headers";
import { MEMBER_ID_COOKIE, resolveBitrixApiForRequest } from "./client";
import type { BitrixApi } from "./client";

export { MEMBER_ID_COOKIE };

/**
 * Возвращает REST-клиент для текущего запроса: сначала пробуем OAuth-сессию
 * портала (установлено приложение в Битрикс24), иначе — вебхук для локальной
 * разработки (DASHBOARD_BITRIX_WEBHOOK_URL в .env).
 */
export async function getBitrixApi(): Promise<BitrixApi | null> {
  const store = await cookies();
  const memberId = store.get(MEMBER_ID_COOKIE)?.value ?? null;
  return resolveBitrixApiForRequest(memberId);
}
