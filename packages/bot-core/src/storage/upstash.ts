import { Redis } from "@upstash/redis";
import { env } from "@psi-opora/config";

export interface StorageAdapter<T> {
  read(key: string): T | undefined | Promise<T | undefined>;
  write(key: string, value: T): void | Promise<void>;
  delete(key: string): void | Promise<void>;
}

export interface BitrixChatInfo {
  chatId: number;
  operatorId: number;
  sessionId: number;
  ts: number;
}

const BITRIX_CHAT_KEY_PREFIX = "b24:chat:";

export function createRedisStorage<T>(redis: Redis): StorageAdapter<T> {
  return {
    async read(key: string) {
      return (await redis.get<T>(key)) ?? undefined;
    },
    async write(key: string, value: T) {
      await redis.set(key, value);
    },
    async delete(key: string) {
      await redis.del(key);
    },
  };
}

export async function getBitrixChatInfo(
  redis: Redis,
  telegramUserId: number,
): Promise<BitrixChatInfo | undefined> {
  const key = `${BITRIX_CHAT_KEY_PREFIX}${telegramUserId}`;
  const info = await redis.get<BitrixChatInfo>(key);
  if (info) {
    await redis.del(key);
  }
  return info ?? undefined;
}

export function createUpstashRedis() {
  const url = env.KV_REST_API_URL;
  const token = env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error("KV_REST_API_URL и KV_REST_API_TOKEN не заданы");
  }
  return new Redis({ url, token });
}
