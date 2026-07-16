import { env } from "@psi-opora/config";
import { forceRefreshPortalTokens, getValidPortalTokens } from "./oauth";

export interface BitrixApi {
  /** Произвольный вызов метода REST API, возвращает "result" из ответа. */
  call<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T>;
  /** Полная выборка списочного метода (crm.deal.list и т.п.) с автопагинацией. */
  list<T = Record<string, unknown>>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T[]>;
}

interface RawResponse {
  result: unknown;
  total?: number;
  next?: number;
  error?: string;
  error_description?: string;
}

const MAX_LIST_PAGES = 400; // защита от бесконечного цикла — до 20000 записей
const MAX_RETRIES = 1;

function isTokenError(error?: string): boolean {
  return error === "expired_token" || error === "invalid_token";
}

function unwrap(json: RawResponse, method: string): unknown {
  if (json.error) {
    throw new Error(
      `Bitrix24 [${method}]: ${json.error} — ${json.error_description ?? ""}`,
    );
  }
  return json.result;
}

async function paginate<T>(
  callPage: (start: number) => Promise<RawResponse>,
  method: string,
): Promise<T[]> {
  const items: T[] = [];
  let start = 0;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const json = await callPage(start);
    const chunk = unwrap(json, method) as T[];
    items.push(...chunk);
    if (typeof json.next !== "number") break;
    start = json.next;
  }
  return items;
}

/** REST-клиент по OAuth-токенам локального приложения (из Redis, с автопродлением). */
export function createOAuthApi(memberId: string): BitrixApi {
  async function request(
    method: string,
    params: Record<string, unknown>,
    start?: number,
    attempt = 0,
  ): Promise<RawResponse> {
    const tokens = await getValidPortalTokens(memberId);
    if (!tokens)
      throw new Error(
        `Нет сохранённой авторизации Bitrix24 для портала ${memberId}`,
      );

    const base = tokens.clientEndpoint.replace(/\/$/, "");
    const res = await fetch(`${base}/${method}.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...params,
        ...(start ? { start } : {}),
        auth: tokens.accessToken,
      }),
    });
    const json = (await res.json()) as RawResponse;

    // Если Битрикс24 ответил, что токен протух — принудительно обновляем и
    // повторяем запрос один раз. Это защищает от clock skew и от ситуаций,
    // когда токен истёк между проверкой и фактическим вызовом.
    if (isTokenError(json.error) && attempt < MAX_RETRIES) {
      await forceRefreshPortalTokens(memberId);
      return request(method, params, start, attempt + 1);
    }

    return json;
  }

  return {
    async call<T>(method: string, params: Record<string, unknown> = {}) {
      const json = await request(method, params);
      return unwrap(json, method) as T;
    },
    list(method, params = {}) {
      return paginate((start) => request(method, params, start), method);
    },
  };
}

/** REST-клиент по входящему вебхуку — для локальной разработки без OAuth-инсталляции. */
export function createWebhookApi(webhookUrl: string): BitrixApi {
  const base = webhookUrl.replace(/\/$/, "");

  async function request(
    method: string,
    params: Record<string, unknown>,
    start?: number,
  ): Promise<RawResponse> {
    const res = await fetch(`${base}/${method}.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...params, ...(start ? { start } : {}) }),
    });
    return (await res.json()) as RawResponse;
  }

  return {
    async call<T>(method: string, params: Record<string, unknown> = {}) {
      const json = await request(method, params);
      return unwrap(json, method) as T;
    },
    list(method, params = {}) {
      return paginate((start) => request(method, params, start), method);
    },
  };
}

/**
 * Клиент Bitrix24 без привязки к HTTP-запросу (для фоновых заданий):
 * по memberId — OAuth-токены портала, иначе — dev-вебхук из env.
 */
export function resolveBitrixApi(memberId?: string): BitrixApi | null {
  if (memberId) return createOAuthApi(memberId);
  if (env.DASHBOARD_BITRIX_WEBHOOK_URL)
    return createWebhookApi(env.DASHBOARD_BITRIX_WEBHOOK_URL);
  return null;
}
