import { getPortalTokens, savePortalTokens, type PortalTokens } from "./tokens";
import { env } from "@psi-opora/config";

// @link https://apidocs.bitrix24.ru/api-reference/oauth/index.html
const OAUTH_SERVER = "https://oauth.bitrix24.tech/oauth/token/";

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
    expiresAt: Math.floor(Date.now() / 1000) + json.expires_in,
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

  const isExpiringSoon = tokens.expiresAt - Math.floor(Date.now() / 1000) < 60;
  if (!isExpiringSoon) return tokens;

  return refreshPortalTokens(tokens);
}
