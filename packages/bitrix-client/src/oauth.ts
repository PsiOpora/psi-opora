import { createUpstashRedis } from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
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

function getClientId(): string {
  const id = env.DASHBOARD_BITRIX_CLIENT_ID;
  if (!id) throw new Error("DASHBOARD_BITRIX_CLIENT_ID не задан");
  return id;
}

function getClientSecret(): string {
  const secret = env.DASHBOARD_BITRIX_CLIENT_SECRET;
  if (!secret) throw new Error("DASHBOARD_BITRIX_CLIENT_SECRET не задан");
  return secret;
}

function refreshLockKey(memberId: string): string {
  return `bitrix24:dashboard:portal:refresh-lock:${memberId}`;
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

/**
 * Блокировка на обновление токенов портала, чтобы параллельные запросы не
 * обновляли refresh_token одновременно (Bitrix24 делает refresh_token
 * одноразовым, и повторный вызов со старым кодом падает).
 */
async function acquireRefreshLock(
  memberId: string,
): Promise<(() => Promise<void>) | null> {
  const redis = createUpstashRedis();
  const key = refreshLockKey(memberId);
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
  memberId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const release = await acquireRefreshLock(memberId);
  if (!release) {
    // Другой процесс уже обновляет токены; подождем и перечитаем.
    await new Promise((resolve) => setTimeout(resolve, 150));
    return withRefreshLock(memberId, fn);
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
): Promise<PortalTokens> {
  const url = new URL(OAUTH_SERVER);
  url.searchParams.set("grant_type", "refresh_token");
  url.searchParams.set("client_id", getClientId());
  url.searchParams.set("client_secret", getClientSecret());
  url.searchParams.set("refresh_token", tokens.refreshToken);

  const res = await fetch(url, { method: "GET" });
  const json = (await res.json()) as OAuthTokenResponse;
  if (json.error) {
    // refresh_token протух или отозван — сбрасываем авторизацию.
    if (json.error === "invalid_grant") {
      await deletePortalTokens(tokens.memberId);
    }
    throw new Error(
      `Bitrix24 OAuth refresh: ${json.error} — ${json.error_description ?? ""}`,
    );
  }

  const updated: PortalTokens = {
    ...tokens,
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    clientEndpoint: json.client_endpoint,
    scope: json.scope,
    expiresAt: nowSeconds() + json.expires_in,
  };
  await savePortalTokens(updated);
  return updated;
}

/** Возвращает актуальные токены портала, обновляя их при необходимости. */
export async function getValidPortalTokens(
  memberId: string,
): Promise<PortalTokens | undefined> {
  const tokens = await getPortalTokens(memberId);
  if (!tokens) return undefined;

  const isExpiringSoon =
    tokens.expiresAt - nowSeconds() < TOKEN_REFRESH_MARGIN_SECONDS;
  if (!isExpiringSoon) return tokens;

  return withRefreshLock(memberId, async () => {
    // Пока мы ждали лока, другой процесс мог уже обновить токены.
    const current = await getPortalTokens(memberId);
    if (!current) return undefined;

    const stillExpiringSoon =
      current.expiresAt - nowSeconds() < TOKEN_REFRESH_MARGIN_SECONDS;
    if (!stillExpiringSoon) return current;

    return refreshPortalTokens(current);
  });
}

/** Принудительно обновляет токены портала (используется при expired_token). */
export async function forceRefreshPortalTokens(
  memberId: string,
): Promise<PortalTokens | undefined> {
  return withRefreshLock(memberId, async () => {
    const tokens = await getPortalTokens(memberId);
    if (!tokens) return undefined;
    return refreshPortalTokens(tokens);
  });
}
