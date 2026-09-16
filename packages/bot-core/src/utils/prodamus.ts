import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Оплата предзаказа книги «Тело берёт своё» — payform.ru на белом лейбле
 * Prodamus. Ссылка на оплату полностью готова и задаётся в личном кабинете
 * payform — никаких параметров к ней не добавляем, отправляем как есть.
 * Здесь только проверяется подпись входящего вебхука об оплате.
 *
 * ВАЖНО: алгоритм подписи реализован по документированной схеме Prodamus
 * (рекурсивная сортировка ключей + HMAC-SHA256 по PHP-style query-string).
 * Перед тем как полагаться на автоподтверждение оплаты в проде, нужно
 * свериться с реальным тестовым платежом и логами вебхука — см. допущение 2
 * в плане.
 */

const PAYFORM_BASE_URL = "https://payform.ru/6ucwABm/";

export interface ProdamusPaymentLinkParams {
	orderId: number;
	phone?: string;
	email?: string;
	sum?: number;
}

export function buildProdamusPaymentUrl(
	_params: ProdamusPaymentLinkParams,
): string {
	return PAYFORM_BASE_URL;
}

/**
 * Рекурсивная сортировка ключей объекта — Prodamus считает подпись по
 * данным, у которых массивы/объекты отсортированы на всех уровнях
 * (см. официальный PHP-пример `Sign::create`).
 */
function sortRecursively(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortRecursively);
	if (value && typeof value === "object") {
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			sorted[key] = sortRecursively((value as Record<string, unknown>)[key]);
		}
		return sorted;
	}
	return value;
}

function toQueryString(value: unknown, prefix = ""): string[] {
	if (value === null || value === undefined) return [];
	if (typeof value === "object") {
		const entries = Array.isArray(value)
			? value.map((item, index) => [String(index), item] as const)
			: Object.entries(value as Record<string, unknown>);
		return entries.flatMap(([key, item]) =>
			toQueryString(item, prefix ? `${prefix}[${key}]` : key),
		);
	}
	return [`${prefix}=${String(value)}`];
}

/** Строка для подписи — PHP http_build_query-совместимый формат, без urlencode. */
function canonicalize(data: Record<string, unknown>): string {
	return toQueryString(sortRecursively(data)).join("&");
}

/**
 * Проверяет заголовок `Sign` вебхука Prodamus. `secretKey` — секретный ключ
 * из личного кабинета payform.ru (раздел «Настройки» → «Оповещения» → ключ
 * для формирования подписи); должен быть задан переменной окружения
 * PRODAMUS_SECRET_KEY, здесь только принимается параметром.
 */
export function verifyProdamusSignature(
	fields: Record<string, unknown>,
	signHeader: string | null | undefined,
	secretKey: string,
): boolean {
	if (!signHeader) return false;
	const expected = createHmac("sha256", secretKey)
		.update(canonicalize(fields))
		.digest("hex");
	const expectedBuf = Buffer.from(expected, "utf8");
	const actualBuf = Buffer.from(signHeader.trim(), "utf8");
	if (expectedBuf.length !== actualBuf.length) return false;
	return timingSafeEqual(expectedBuf, actualBuf);
}
