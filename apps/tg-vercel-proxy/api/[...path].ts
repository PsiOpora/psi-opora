import { Hono } from "hono";
import { handle } from "hono/vercel";

export const config = { runtime: "edge" };

const TELEGRAM_API_ROOT = "https://api.telegram.org";
// Файловая маршрутизация Vercel отдаёт функции путь с префиксом /api (сама
// функция лежит в api/[...path].ts) — vercel.json переписывает сюда любой
// путь верхнего уровня (см. rewrites), поэтому префикс нужно снять перед
// пересылкой в Telegram.
const FUNCTION_PREFIX = "/api";
// Пропускаем только пути реального Bot API Telegram (/bot<token>/<method> и
// /file/bot<token>/<path>) — иначе публичный Vercel-URL превратился бы в
// открытый прокси на произвольные адреса.
const ALLOWED_PREFIXES = ["/bot", "/file/bot"];

const app = new Hono();

/**
 * Reverse-прокси к api.telegram.org для apps/tg-bot (см. TG_API_PROXY_* в
 * packages/config/src/env.ts и packages/bot-core/src/utils/telegram-proxy.ts) —
 * на время переезда с РФ-хостинга, пока прямые запросы к Telegram с k3s
 * ненадёжны. Требует общий секрет (PROXY_SECRET), если он задан в env
 * деплоя — без него любой, кто узнает URL, мог бы дёргать Telegram от имени
 * бота, если это вдруг попадёт в чужие руки.
 */
app.all("*", async (c) => {
  const path = c.req.path.startsWith(FUNCTION_PREFIX)
    ? c.req.path.slice(FUNCTION_PREFIX.length)
    : c.req.path;

  if (!ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return c.notFound();
  }

  const secret = process.env.PROXY_SECRET;
  if (secret && c.req.header("x-proxy-secret") !== secret) {
    return c.text("Unauthorized", 401);
  }

  const headers = new Headers(c.req.raw.headers);
  headers.delete("host");
  headers.delete("x-proxy-secret");

  const hasBody = c.req.method !== "GET" && c.req.method !== "HEAD";
  const search = new URL(c.req.url).search;
  const response = await fetch(`${TELEGRAM_API_ROOT}${path}${search}`, {
    method: c.req.method,
    headers,
    body: hasBody ? c.req.raw.body : undefined,
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
});

export default handle(app);
