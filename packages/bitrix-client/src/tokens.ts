import {
	createRedisClient,
	createRedisStorage,
	type StorageAdapter,
} from "@psi-opora/bot-core";
import type { BitrixAppName } from "./app-name";

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
	storage ??= createRedisStorage<PortalTokens>(createRedisClient());
	return storage;
}

// Токены хранятся отдельно на каждое Bitrix24-приложение (свой client_id/secret),
// даже если оба приложения авторизованы на одном и том же портале (memberId).
function redisKey(app: BitrixAppName, memberId: string): string {
	return `bitrix24:${app}:portal:${memberId}`;
}

export async function getPortalTokens(
	memberId: string,
	app: BitrixAppName = "dashboard",
): Promise<PortalTokens | undefined> {
	return getStorage().read(redisKey(app, memberId));
}

export async function savePortalTokens(
	tokens: PortalTokens,
	app: BitrixAppName = "dashboard",
): Promise<void> {
	await getStorage().write(redisKey(app, tokens.memberId), tokens);
}

export async function deletePortalTokens(
	memberId: string,
	app: BitrixAppName = "dashboard",
): Promise<void> {
	await getStorage().delete(redisKey(app, memberId));
}
