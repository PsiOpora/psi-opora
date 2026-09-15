import {
	createRedisClient,
	isRedisConfigured as hasRedisConfiguration,
} from "@psi-opora/bot-core";

export type RedisClient = ReturnType<typeof createRedisClient>;

export function isRedisConfigured(): boolean {
	return hasRedisConfiguration();
}

/** null, если Redis не задан (локальная разработка без Redis). */
export function getRedisOrNull(): RedisClient | null {
	return isRedisConfigured() ? createRedisClient() : null;
}
