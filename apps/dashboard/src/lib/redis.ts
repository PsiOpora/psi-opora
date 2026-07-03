import { createUpstashRedis } from "@psi-opora/bot-core";

export type RedisClient = ReturnType<typeof createUpstashRedis>;

export function isRedisConfigured(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

/** null, если KV_REST_API_URL/KV_REST_API_TOKEN не заданы (локальная разработка без Redis). */
export function getRedisOrNull(): RedisClient | null {
  return isRedisConfigured() ? createUpstashRedis() : null;
}
