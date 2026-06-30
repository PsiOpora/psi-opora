import { Redis } from "@upstash/redis";
import type { StorageAdapter } from "grammy";

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

export function createUpstashRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error("UPSTASH_REDIS_REST_URL и UPSTASH_REDIS_REST_TOKEN не заданы");
  }
  return new Redis({ url, token });
}
