import { createUpstashRedis } from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";

export type RedisClient = ReturnType<typeof createUpstashRedis>;

export function isRedisConfigured(): boolean {
  return Boolean(env.KV_REST_API_URL && env.KV_REST_API_TOKEN);
}

/** null, если KV_REST_API_URL/KV_REST_API_TOKEN не заданы (локальная разработка без Redis). */
export function getRedisOrNull(): RedisClient | null {
  return isRedisConfigured() ? createUpstashRedis() : null;
}
