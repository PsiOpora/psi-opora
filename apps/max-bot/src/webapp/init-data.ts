import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Проверка initData мини-приложения MAX (window.WebApp.initData) по
 * https://dev.max.ru/docs/webapps/validation: пары key=value без `hash`,
 * отсортированные по ключу и склеенные через `\n`, подписываются
 * HMAC-SHA256 ключом HMAC_SHA256("WebAppData", token бота). Без проверки
 * любой мог бы прислать чужой user_id и запустить сценарий в чужом чате.
 */

const maxWebAppUserSchema = z.object({
	id: z.number().int().positive(),
	first_name: z.string().optional(),
	last_name: z.string().nullish(),
	username: z.string().nullish(),
	language_code: z.string().nullish(),
});

export type MaxWebAppUser = z.infer<typeof maxWebAppUserSchema>;

export interface VerifiedInitData {
	user: MaxWebAppUser;
	authDate: number;
	startParam?: string;
}

/** Сколько живёт подпись: страницу могут держать открытой, но не сутками. */
export const INIT_DATA_MAX_AGE_SEC = 24 * 60 * 60;

export function signInitData(
	params: URLSearchParams,
	botToken: string,
): string {
	const dataCheckString = [...params.entries()]
		.filter(([key]) => key !== "hash")
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([key, value]) => `${key}=${value}`)
		.join("\n");
	const secretKey = createHmac("sha256", "WebAppData")
		.update(botToken)
		.digest();
	return createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
}

export function verifyMaxInitData(
	initData: string,
	botToken: string,
	nowSec = Math.floor(Date.now() / 1000),
): VerifiedInitData | null {
	if (!initData || !botToken) return null;
	const params = new URLSearchParams(initData);
	const hashes = params.getAll("hash");
	if (hashes.length !== 1 || !hashes[0]) return null;

	const expected = Buffer.from(signInitData(params, botToken), "hex");
	const actual = Buffer.from(hashes[0], "hex");
	if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
		return null;
	}

	const authDate = Number(params.get("auth_date"));
	if (!Number.isFinite(authDate) || nowSec - authDate > INIT_DATA_MAX_AGE_SEC) {
		return null;
	}

	let rawUser: unknown;
	try {
		rawUser = JSON.parse(params.get("user") ?? "");
	} catch {
		return null;
	}
	const user = maxWebAppUserSchema.safeParse(rawUser);
	if (!user.success) return null;

	const startParam = params.get("start_param") ?? undefined;
	return {
		user: user.data,
		authDate,
		...(startParam ? { startParam } : {}),
	};
}
