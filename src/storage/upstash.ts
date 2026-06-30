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
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error("KV_REST_API_URL и KV_REST_API_TOKEN не заданы");
  }
  return new Redis({ url, token });
}
