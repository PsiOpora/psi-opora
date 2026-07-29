import { createRedisClient } from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import type { BitrixAppName } from "./app-name";
import {
  deletePortalTokens,
  getPortalTokens,
  type PortalTokens,
  savePortalTokens,
} from "./tokens";

// @link https://apidocs.bitrix24.ru/api-reference/oauth/index.html
const OAUTH_SERVER = "https://oauth.bitrix24.tech/oauth/token/";

const TOKEN_REFRESH_MARGIN_SECONDS = 5 * 60; // обновляем токен за 5 минут до истечения
const REFRESH_LOCK_TTL_SECONDS = 10;

const CLIENT_CREDENTIALS: Record<
  BitrixAppName,
  { id: string | undefined; secret: string | undefined }
> = {
  dashboard: {
    id: env.DASHBOARD_BITRIX_CLIENT_ID,
    secret: env.DASHBOARD_BITRIX_CLIENT_SECRET,
  },
  clients: {
    id: env.CLIENTS_BITRIX_CLIENT_ID,
    secret: env.CLIENTS_BITRIX_CLIENT_SECRET,
  },
};

function getClientId(app: BitrixAppName): string {
  const id = CLIENT_CREDENTIALS[app].id;
  if (!id) throw new Error(`${app}: BITRIX_CLIENT_ID не задан`);
  return id;
}

function getClientSecret(app: BitrixAppName): string {
  const secret = CLIENT_CREDENTIALS[app].secret;
  if (!secret) throw new Error(`${app}: BITRIX_CLIENT_SECRET не задан`);
  return secret;
}

function refreshLockKey(app: BitrixAppName, memberId: string): string {
  return `bitrix24:${app}:portal:refresh-lock:${memberId}`;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  client_endpoint: string;
  member_id: string;
  scope: string;
  error?: string;
  error_description?: string;
}

interface ProfileResponse {
  result?: { ID?: string | number };
  error?: string;
  error_description?: string;
}

interface AppInfoResponse {
  result?: { ID?: string | number; INSTALLED?: boolean };
  error?: string;
  error_description?: string;
}

function normalizedBitrixEndpoint(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("Bitrix24 OAuth: небезопасный client_endpoint");
  }
  if (!url.pathname.startsWith("/rest/")) {
    throw new Error("Bitrix24 OAuth: некорректный client_endpoint");
  }
  return url;
}

function configuredPortalEndpoint(): URL {
  if (!env.DASHBOARD_BITRIX_WEBHOOK_URL) {
    throw new Error("Bitrix24 session: DASHBOARD_BITRIX_WEBHOOK_URL не задан");
  }
  const url = new URL(env.DASHBOARD_BITRIX_WEBHOOK_URL);
  if (url.protocol !== "https:" || !url.hostname) {
    throw new Error("Bitrix24 session: некорректный домен портала");
  }
  return new URL("/rest/", url.origin);
}

function normalizedPortalHostname(value: string): string {
  const url = new URL(value.includes("://") ? value : `https://${value}`);
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("Bitrix24 session: некорректный домен портала");
  }
  return url.hostname.toLowerCase();
}

async function callWithAccessToken<T>(
  endpoint: URL,
  method: string,
  accessToken: string,
): Promise<T> {
  const base = endpoint.toString().replace(/\/$/, "");
  const response = await fetch(`${base}/${method}.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ auth: accessToken }),
  });
  if (!response.ok) {
    throw new Error(`Bitrix24 ${method}: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * Проверяет короткоживущий AUTH_ID, полученный при открытии приложения во
 * фрейме. Не обновляет refresh_token: SDK Bitrix24 управляет им сам, а
 * принудительный обмен при каждом открытии создаёт гонку одноразовых токенов.
 */
export async function verifyPortalAccessToken(
  tokens: PortalTokens,
): Promise<{ userId: string; clientEndpoint: string }> {
  if (!env.BITRIX_MEMBER_ID) {
    throw new Error("Bitrix24 session: BITRIX_MEMBER_ID не задан");
  }
  if (tokens.memberId !== env.BITRIX_MEMBER_ID) {
    throw new Error("Bitrix24 session: неизвестный портал");
  }

  // REST endpoint строим только из серверной конфигурации. Значение,
  // пришедшее из браузера, не используем как URL назначения.
  const endpoint = configuredPortalEndpoint();
  // DOMAIN — адрес портала для интерфейса, а не обязательно хост REST API.
  // Bitrix24 может, например, передать portal.bitrix24.com в domain и
  // portal.bitrix24.ru в client_endpoint. Поэтому здесь проверяем только
  // безопасный формат домена; принадлежность порталу подтверждают member_id
  // и вызовы profile/app.info через серверно настроенный endpoint.
  normalizedPortalHostname(tokens.domain);

  const [profile, appInfo] = await Promise.all([
    callWithAccessToken<ProfileResponse>(
      endpoint,
      "profile",
      tokens.accessToken,
    ),
    callWithAccessToken<AppInfoResponse>(
      endpoint,
      "app.info",
      tokens.accessToken,
    ),
  ]);

  if (profile.error || !profile.result?.ID) {
    throw new Error(
      `Bitrix24 profile: ${profile.error ?? "invalid_response"} — ${
        profile.error_description ?? ""
      }`,
    );
  }
  if (appInfo.error || !appInfo.result?.ID) {
    throw new Error(
      `Bitrix24 app.info: ${appInfo.error ?? "invalid_response"} — ${
        appInfo.error_description ?? ""
      }`,
    );
  }

  return {
    userId: String(profile.result.ID),
    clientEndpoint: endpoint.toString(),
  };
}

async function requestRefreshedTokens(
  tokens: PortalTokens,
  app: BitrixAppName,
): Promise<PortalTokens> {
  const url = new URL(OAUTH_SERVER);
  url.searchParams.set("grant_type", "refresh_token");
  url.searchParams.set("client_id", getClientId(app));
  url.searchParams.set("client_secret", getClientSecret(app));
  url.searchParams.set("refresh_token", tokens.refreshToken);

  const res = await fetch(url, { method: "GET" });
  const json = (await res.json()) as OAuthTokenResponse;
  if (json.error) {
    throw new Error(
      `Bitrix24 OAuth refresh: ${json.error} — ${json.error_description ?? ""}`,
    );
  }
  if (json.member_id !== tokens.memberId) {
    throw new Error("Bitrix24 OAuth: member_id не совпадает");
  }

  const endpoint = normalizedBitrixEndpoint(json.client_endpoint);
  const previousEndpoint = normalizedBitrixEndpoint(tokens.clientEndpoint);
  if (
    endpoint.hostname.toLowerCase() !==
    previousEndpoint.hostname.toLowerCase()
  ) {
    throw new Error("Bitrix24 OAuth: домен портала не совпадает");
  }

  return {
    ...tokens,
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    clientEndpoint: endpoint.toString(),
    scope: json.scope,
    expiresAt: nowSeconds() + json.expires_in,
  };
}

/**
 * Блокировка на обновление токенов портала, чтобы параллельные запросы не
 * обновляли refresh_token одновременно (Bitrix24 делает refresh_token
 * одноразовым, и повторный вызов со старым кодом падает).
 */
async function acquireRefreshLock(
  app: BitrixAppName,
  memberId: string,
): Promise<(() => Promise<void>) | null> {
  const redis = createRedisClient();
  const key = refreshLockKey(app, memberId);
  // Глобальный Web Crypto API (не node:crypto) — совместимо с Edge Runtime,
  // где деплоится apps/max-bot.
  const token = crypto.randomUUID();
  const acquired = await redis.set(key, token, {
    nx: true,
    ex: REFRESH_LOCK_TTL_SECONDS,
  });
  if (!acquired) return null;

  return async () => {
    const current = await redis.get<string>(key);
    if (current === token) {
      await redis.del(key);
    }
  };
}

async function withRefreshLock<T>(
  app: BitrixAppName,
  memberId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const release = await acquireRefreshLock(app, memberId);
  if (!release) {
    // Другой процесс уже обновляет токены; подождем и перечитаем.
    await new Promise((resolve) => setTimeout(resolve, 150));
    return withRefreshLock(app, memberId, fn);
  }

  try {
    return await fn();
  } finally {
    await release();
  }
}

/**
 * Продлевает access_token по refresh_token.
 * @link https://apidocs.bitrix24.ru/api-reference/oauth/index.html
 */
export async function refreshPortalTokens(
  tokens: PortalTokens,
  app: BitrixAppName = "dashboard",
): Promise<PortalTokens> {
  let updated: PortalTokens;
  try {
    updated = await requestRefreshedTokens(tokens, app);
  } catch (error) {
    // refresh_token протух или отозван — сбрасываем авторизацию.
    if (error instanceof Error && error.message.includes("invalid_grant")) {
      await deletePortalTokens(tokens.memberId, app);
    }
    throw error;
  }
  await savePortalTokens(updated, app);
  return updated;
}

/**
 * Проверяет, что refresh_token действительно выпущен для нашего приложения,
 * затем подтверждает пользователя базовым REST-методом profile и только после
 * этого сохраняет обновлённые токены.
 */
export async function verifyAndSavePortalTokens(
  tokens: PortalTokens,
  app: BitrixAppName,
): Promise<{ tokens: PortalTokens; userId: string }> {
  const updated = await requestRefreshedTokens(tokens, app);
  const base = updated.clientEndpoint.replace(/\/$/, "");
  const response = await fetch(`${base}/profile.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ auth: updated.accessToken }),
  });
  const json = (await response.json()) as ProfileResponse;
  if (json.error || !json.result?.ID) {
    throw new Error(
      `Bitrix24 profile: ${json.error ?? "invalid_response"} — ${
        json.error_description ?? ""
      }`,
    );
  }

  await savePortalTokens(updated, app);
  return { tokens: updated, userId: String(json.result.ID) };
}

/** Возвращает актуальные токены портала, обновляя их при необходимости. */
export async function getValidPortalTokens(
  memberId: string,
  app: BitrixAppName = "dashboard",
): Promise<PortalTokens | undefined> {
  const tokens = await getPortalTokens(memberId, app);
  if (!tokens) return undefined;

  const isExpiringSoon =
    tokens.expiresAt - nowSeconds() < TOKEN_REFRESH_MARGIN_SECONDS;
  if (!isExpiringSoon) return tokens;

  return withRefreshLock(app, memberId, async () => {
    // Пока мы ждали лока, другой процесс мог уже обновить токены.
    const current = await getPortalTokens(memberId, app);
    if (!current) return undefined;

    const stillExpiringSoon =
      current.expiresAt - nowSeconds() < TOKEN_REFRESH_MARGIN_SECONDS;
    if (!stillExpiringSoon) return current;

    return refreshPortalTokens(current, app);
  });
}

/** Принудительно обновляет токены портала (используется при expired_token). */
export async function forceRefreshPortalTokens(
  memberId: string,
  app: BitrixAppName = "dashboard",
): Promise<PortalTokens | undefined> {
  return withRefreshLock(app, memberId, async () => {
    const tokens = await getPortalTokens(memberId, app);
    if (!tokens) return undefined;
    return refreshPortalTokens(tokens, app);
  });
}
