import { Hono } from "hono";

// Zero-config Hono на Vercel: файл на верхнем уровне (server.ts) с
// `export default app` — Vercel сам превращает маршруты Hono в Vercel
// Functions, без hono/vercel, без api/ и без vercel.json.
// См. https://vercel.com/docs/frameworks/backend/hono

// Узкая локальная замена @types/node: сборка Vercel транслирует этот файл
// собственным tsc в изолированном окружении, где резолвинг @types/node как
// entry point типов ("types": ["node"] в tsconfig) не всегда стабилен
// (TS2688) — process.env здесь единственное, что реально нужно от Node.
declare const process: { env: Record<string, string | undefined> };

const TELEGRAM_API_ROOT = "https://api.telegram.org";
// Пропускаем только пути реального Bot API Telegram (/bot<token>/<method> и
// /file/bot<token>/<path>) — иначе публичный Vercel-URL превратился бы в
// открытый прокси на произвольные адреса.
const ALLOWED_PREFIXES = ["/bot", "/file/bot"];

// Куда транслировать входящие вебхуки от Telegram — реальный apps/tg-bot в
// k3s (см. k3s/tg-bot.yaml, IngressRoute Host psi-opora-tg.orixon.ru).
// Переопределяемо через TG_BOT_ORIGIN_URL на случай смены адреса без
// передеплоя кода прокси.
const TG_BOT_ORIGIN =
	process.env.TG_BOT_ORIGIN_URL ?? "https://psi-opora-tg.orixon.ru";

function stripHopHeaders(headers: Headers): Headers {
	const copy = new Headers(headers);
	copy.delete("host");
	copy.delete("x-proxy-secret");
	return copy;
}

// lib.dom.d.ts, встроенный в TypeScript, ещё не знает про `duplex` (нужен для
// потокового body в fetch) — @types/node сюда специально не подключаем (см.
// declare const process выше), поэтому просто расширяем RequestInit локально.
type StreamingRequestInit = RequestInit & { duplex?: "half" };

const app = new Hono();

// Простой health-check — убедиться, что деплой вообще жив, до подключения
// реального трафика Telegram.
app.get("/", (c) => c.text("hello world"));

/**
 * Транслирует входящий вебхук Telegram (POST /webhook) на реальный
 * apps/tg-bot в k3s — Telegram делает вебхук-запросы на этот Vercel-адрес
 * (см. TG_WEBHOOK_URL), а не на psi-opora-tg.orixon.ru напрямую, на время
 * переезда с РФ-хостинга, пока доставка входящих вебхуков туда ненадёжна.
 * Проверяет secret_token (см. TG_WEBHOOK_SECRET в setWebhook,
 * apps/tg-bot/scripts/set-webhook.ts) — без него любой мог бы слать боту
 * поддельные апдейты, зная только публичный URL.
 */
app.post("/webhook", async (c) => {
	const secret = process.env.TG_WEBHOOK_SECRET;
	if (secret && c.req.header("x-telegram-bot-api-secret-token") !== secret) {
		return c.text("Unauthorized", 401);
	}

	const init: StreamingRequestInit = {
		method: "POST",
		headers: stripHopHeaders(c.req.raw.headers),
		body: c.req.raw.body,
		duplex: "half",
	};
	const response = await fetch(`${TG_BOT_ORIGIN}/api/webhook`, init);

	const responseHeaders = new Headers(response.headers);
	responseHeaders.delete("content-encoding");
	responseHeaders.delete("content-length");

	return new Response(response.body, {
		status: response.status,
		headers: responseHeaders,
	});
});

/**
 * Reverse-прокси к api.telegram.org для apps/tg-bot (см. TG_API_PROXY_* в
 * packages/config/src/env.ts и packages/bot-core/src/utils/telegram-proxy.ts) —
 * на время переезда с РФ-хостинга, пока прямые запросы к Telegram с k3s
 * ненадёжны. Требует общий секрет (PROXY_SECRET), если он задан в env
 * деплоя — без него любой, кто узнает URL, мог бы дёргать Telegram от имени
 * бота, если это вдруг попадёт в чужие руки.
 */
app.all("*", async (c) => {
	const path = c.req.path;

	if (!ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
		return c.notFound();
	}

	const secret = process.env.PROXY_SECRET;
	if (secret && c.req.header("x-proxy-secret") !== secret) {
		return c.text("Unauthorized", 401);
	}

	const hasBody = c.req.method !== "GET" && c.req.method !== "HEAD";
	const search = new URL(c.req.url).search;
	const init: StreamingRequestInit = {
		method: c.req.method,
		headers: stripHopHeaders(c.req.raw.headers),
		body: hasBody ? c.req.raw.body : undefined,
		duplex: hasBody ? "half" : undefined,
	};
	const response = await fetch(`${TELEGRAM_API_ROOT}${path}${search}`, init);

	const responseHeaders = new Headers(response.headers);
	// Пересчитываются рантаймом при сборке Response — оставлять исходные
	// значения от Telegram может рассинхронизировать их с реальным телом.
	responseHeaders.delete("content-encoding");
	responseHeaders.delete("content-length");

	return new Response(response.body, {
		status: response.status,
		headers: responseHeaders,
	});
});

export default app;
