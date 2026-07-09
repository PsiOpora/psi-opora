import {
  createRedisStorage,
  createUpstashRedis,
  type StorageAdapter,
} from "@psi-opora/bot-core";

export interface PortalTokens {
  memberId: string;
  domain: string;
  clientEndpoint: string;
  accessToken: string;
  refreshToken: string;
  /** unix timestamp (seconds) когда access_token истекает */
  expiresAt: number;
  scope: string;
}

let storage: StorageAdapter<PortalTokens> | undefined;

function getStorage(): StorageAdapter<PortalTokens> {
  storage ??= createRedisStorage<PortalTokens>(createUpstashRedis());
  return storage;
}

function redisKey(memberId: string): string {
  return `bitrix24:dashboard:portal:${memberId}`;
}

export async function getPortalTokens(
  memberId: string,
): Promise<PortalTokens | undefined> {
  return getStorage().read(redisKey(memberId));
}

export async function savePortalTokens(tokens: PortalTokens): Promise<void> {
  await getStorage().write(redisKey(tokens.memberId), tokens);
}

export async function deletePortalTokens(memberId: string): Promise<void> {
  await getStorage().delete(redisKey(memberId));
}
