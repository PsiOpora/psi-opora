import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Подпись Т-Банка (Token) для эквайринга — и для уведомлений, и для запросов
 * Init: берём все скалярные параметры, кроме Token (вложенные объекты Data и
 * Receipt в подпись не входят), добавляем Password, сортируем по ключу,
 * склеиваем значения и считаем SHA-256. null/undefined в подпись не идут.
 * https://developer.tbank.ru/eacq/intro/developer/notification
 */
export function computeTbankToken(
	params: Record<string, unknown>,
	password: string,
): string {
	const pairs: [string, string][] = [["Password", password]];
	for (const [key, value] of Object.entries(params)) {
		if (key === "Token") continue;
		if (typeof value === "string") pairs.push([key, value]);
		else if (typeof value === "number" || typeof value === "boolean")
			pairs.push([key, String(value)]);
	}
	pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return createHash("sha256")
		.update(pairs.map(([, v]) => v).join(""), "utf8")
		.digest("hex");
}

export function verifyTbankToken(
	params: Record<string, unknown>,
	password: string,
): boolean {
	const received = params.Token;
	if (typeof received !== "string") return false;
	const expected = Buffer.from(computeTbankToken(params, password));
	const actual = Buffer.from(received.toLowerCase());
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}
