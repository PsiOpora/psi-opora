/**
 * Публичный origin дашборда по заголовкам запроса — за ingress/прокси
 * настоящий хост приходит в X-Forwarded-*. Нужен для абсолютных ссылок,
 * которые открываются вне Битрикс24: картинки и ссылка отписки в письмах.
 */
export function publicOriginFromHeaders(headers: Headers): string | null {
	const host = headers.get("x-forwarded-host") ?? headers.get("host");
	if (!host) return null;
	const proto =
		headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
		(/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? "http" : "https");
	return `${proto}://${host.split(",")[0]?.trim()}`;
}
