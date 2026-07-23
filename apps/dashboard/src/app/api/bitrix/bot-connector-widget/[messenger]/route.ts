import { env } from "@psi-opora/config";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Обработчик встраивания (PLACEMENT_HANDLER) коннектора Открытой линии
 * официального бота — сегмент пути `[messenger]` ("telegram"/"max")
 * пришивается при регистрации (см. bot-connector-card.tsx, handlerUrl()),
 * чтобы не зависеть от того, сохраняет ли Bitrix произвольную query-строку
 * в PLACEMENT_HANDLER (та же неопределённость, что и у tg-personal-widget).
 * Bitrix шлёт POST с PLACEMENT_OPTIONS, страница дальше — обычный GET,
 * поэтому редиректим, перенося LINE в query.
 */
async function handle(
  request: Request,
  { params }: { params: Promise<{ messenger: string }> },
): Promise<Response> {
  const { messenger } = await params;
  const url = new URL(request.url);
  const target = new URL("/widget/bot-connector", env.APP_URL);
  target.searchParams.set("messenger", messenger);
  url.searchParams.forEach((value, key) => {
    target.searchParams.set(key, value);
  });

  if (request.method === "POST") {
    const form = await request.formData().catch(() => null);
    try {
      // TODO: проверить на реальном портале Bitrix24 формат PLACEMENT_OPTIONS
      // для SETTING_CONNECTOR — см. такой же TODO у tg-personal-widget/route.ts.
      const options = JSON.parse(
        String(form?.get("PLACEMENT_OPTIONS") ?? "{}"),
      ) as { LINE?: string | number };
      if (options.LINE != null) {
        target.searchParams.set("line", String(options.LINE));
      }
    } catch {
      // PLACEMENT_OPTIONS не JSON — страница покажет «нет данных о линии»
    }
  }

  return NextResponse.redirect(target, 303);
}

export const POST = handle;
export const GET = handle;
