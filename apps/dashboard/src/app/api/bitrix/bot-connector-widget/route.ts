import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Обработчик встраивания (PLACEMENT_HANDLER) коннекторов Открытых линий для
 * официальных ботов (Telegram/MAX Bot API) — в отличие от личного номера
 * (см. /api/bitrix/tg-personal-widget) здесь нечего настраивать: токен бота
 * и линия уже заданы в .env, вводить нечего. Страница просто информирует
 * администратора об этом. Как и у остальных плейсментов: Bitrix шлёт POST,
 * страница дальше — обычный GET, поэтому редиректим.
 */
async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  return NextResponse.redirect(new URL("/widget/bot-connector-info", url.origin), 303);
}

export const POST = handle;
export const GET = handle;
