import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@psi-opora/config";
import type { BitrixAppName } from "./app-name";

export const CLIENTS_SESSION_COOKIE = "__Host-b24_clients_session";
export const DASHBOARD_SESSION_COOKIE = "__Host-b24_dashboard_session";

const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MEDIA_URL_TTL_SECONDS = 15 * 60;

export interface BitrixSessionClaims {
	app: BitrixAppName;
	memberId: string;
	userId: string;
	domain: string;
	exp: number;
}

function signingSecret(app: BitrixAppName): string {
	const secret =
		app === "clients"
			? env.CLIENTS_BITRIX_CLIENT_SECRET
			: env.DASHBOARD_BITRIX_CLIENT_SECRET;
	if (!secret) {
		throw new Error(`${app}: BITRIX_CLIENT_SECRET не задан`);
	}
	return secret;
}

function hmac(value: string, secret: string): string {
	return createHmac("sha256", secret).update(value).digest("base64url");
}

function signaturesEqual(actual: string, expected: string): boolean {
	const actualBuffer = Buffer.from(actual, "base64url");
	const expectedBuffer = Buffer.from(expected, "base64url");
	return (
		actualBuffer.length === expectedBuffer.length &&
		timingSafeEqual(actualBuffer, expectedBuffer)
	);
}

function validClaims(value: unknown): value is BitrixSessionClaims {
	if (!value || typeof value !== "object") return false;
	const claims = value as Record<string, unknown>;
	return (
		(claims.app === "clients" || claims.app === "dashboard") &&
		typeof claims.memberId === "string" &&
		claims.memberId.length > 0 &&
		claims.memberId.length <= 128 &&
		typeof claims.userId === "string" &&
		claims.userId.length > 0 &&
		claims.userId.length <= 64 &&
		typeof claims.domain === "string" &&
		claims.domain.length > 0 &&
		claims.domain.length <= 255 &&
		typeof claims.exp === "number" &&
		Number.isSafeInteger(claims.exp)
	);
}

export function createBitrixSessionToken(
	claims: Omit<BitrixSessionClaims, "exp">,
	secret = signingSecret(claims.app),
	nowSeconds = Math.floor(Date.now() / 1000),
): string {
	const payload = Buffer.from(
		JSON.stringify({
			...claims,
			exp: nowSeconds + SESSION_TTL_SECONDS,
		} satisfies BitrixSessionClaims),
	).toString("base64url");
	return `${payload}.${hmac(`bitrix-session:${payload}`, secret)}`;
}

export function verifyBitrixSessionToken(
	token: string | undefined,
	expectedApp: BitrixAppName,
	secret = signingSecret(expectedApp),
	nowSeconds = Math.floor(Date.now() / 1000),
): BitrixSessionClaims | null {
	if (!token) return null;
	const [payload, signature, extra] = token.split(".");
	if (!payload || !signature || extra) return null;

	const expected = hmac(`bitrix-session:${payload}`, secret);
	if (!signaturesEqual(signature, expected)) return null;

	try {
		const claims: unknown = JSON.parse(
			Buffer.from(payload, "base64url").toString("utf8"),
		);
		if (!validClaims(claims)) return null;
		if (claims.app !== expectedApp || claims.exp <= nowSeconds) return null;
		return claims;
	} catch {
		return null;
	}
}

export function createMessageMediaSignature(
	messageId: string,
	secret = signingSecret("clients"),
	nowSeconds = Math.floor(Date.now() / 1000),
): { expires: number; signature: string } {
	const expires = nowSeconds + MEDIA_URL_TTL_SECONDS;
	return {
		expires,
		signature: hmac(`message-media:${messageId}:${expires}`, secret),
	};
}

export function verifyMessageMediaSignature(
	messageId: string,
	expires: number,
	signature: string,
	secret = signingSecret("clients"),
	nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
	if (!Number.isSafeInteger(expires) || expires <= nowSeconds) return false;
	if (expires > nowSeconds + MEDIA_URL_TTL_SECONDS) return false;
	const expected = hmac(`message-media:${messageId}:${expires}`, secret);
	return signaturesEqual(signature, expected);
}
