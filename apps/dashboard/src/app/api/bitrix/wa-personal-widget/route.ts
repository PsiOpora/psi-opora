import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Обработчик встраивания (PLACEMENT_HANDLER) коннектора Открытых линий
 * «WhatsApp (личный номер)» — Bitrix24 открывает его в слайдере, когда
 * администратор подключает канал на конкретной линии Контакт-центра
 * (placement `SETTING_CONNECTOR`, тот же механизм, что и у
 * /api/bitrix/tg-personal-widget). Bitrix шлёт POST с PLACEMENT_OPTIONS,
 * а страница дальше — обычный GET, поэтому редиректим, перенося параметры
 * (DOMAIN, APP_SID и т.д. нужны @bitrix24/b24jssdk для авторизации).
 */
async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const target = new URL("/widget/wa-personal-connector", url.origin);
  url.searchParams.forEach((value, key) => {
    target.searchParams.set(key, value);
  });

  if (request.method === "POST") {
    const form = await request.formData().catch(() => null);
    try {
      // TODO: проверить на реальном портале Bitrix24, что PLACEMENT_OPTIONS
      // для SETTING_CONNECTOR действительно содержит LINE в этом виде —
      // то же предположение, что и у tg-personal-widget (см. TODO там).
      const options = JSON.parse(
        String(form?.get("PLACEMENT_OPTIONS") ?? "{}"),
      ) as { LINE?: string | number; CONNECTOR?: string };
      if (options.LINE != null) {
        target.searchParams.set("line", String(options.LINE));
      }
      if (options.CONNECTOR) {
        target.searchParams.set("connector", options.CONNECTOR);
      }
    } catch {
      // PLACEMENT_OPTIONS не JSON — страница покажет «нет данных о линии»
    }
  }

  return NextResponse.redirect(target, 303);
}

export const POST = handle;
export const GET = handle;
