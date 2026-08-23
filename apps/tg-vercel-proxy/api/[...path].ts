export const config = { runtime: "edge" };

const TELEGRAM_API_ROOT = "https://api.telegram.org";

// Пропускаем только пути реального Bot API Telegram (/bot<token>/<method> и
// /file/bot<token>/<path>) — иначе публичный Vercel-URL превратился бы в
// открытый прокси на произвольные адреса.
const ALLOWED_PREFIXES = ["/bot", "/file/bot"];

/**
 * Reverse-прокси к api.telegram.org для apps/tg-bot (см. TG_API_PROXY_* в
 * packages/config/src/env.ts и packages/bot-core/src/utils/telegram-proxy.ts) —
 * на время переезда с РФ-хостинга, пока прямые запросы к Telegram с k3s
 * ненадёжны. Требует общий секрет (PROXY_SECRET), если он задан в env
 * деплоя — без него любой, кто узнает URL, мог бы дёргать Telegram от имени
 * бота, если это вдруг попадёт в чужие руки.
 */
export default async function handler(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname;

	if (!ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
		return new Response("Not found", { status: 404 });
	}

	const secret = process.env.PROXY_SECRET;
	if (secret && request.headers.get("x-proxy-secret") !== secret) {
		return new Response("Unauthorized", { status: 401 });
	}

	const headers = new Headers(request.headers);
	headers.delete("host");
	headers.delete("x-proxy-secret");

	const hasBody = request.method !== "GET" && request.method !== "HEAD";
	const response = await fetch(`${TELEGRAM_API_ROOT}${path}${url.search}`, {
		method: request.method,
		headers,
		body: hasBody ? request.body : undefined,
		// @ts-expect-error duplex обязателен для потокового body в fetch на Edge Runtime
		duplex: hasBody ? "half" : undefined,
	});

	const responseHeaders = new Headers(response.headers);
	// Пересчитываются рантаймом при сборке Response — оставлять исходные
	// значения от Telegram может рассинхронизировать их с реальным телом.
	responseHeaders.delete("content-encoding");
	responseHeaders.delete("content-length");

	return new Response(response.body, {
		status: response.status,
		headers: responseHeaders,
	});
}
