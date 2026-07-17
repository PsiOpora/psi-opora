import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Обработчик места встраивания Bitrix24 (placement.bind указывает сюда).
 * Битрикс открывает handler в iframe POST-запросом с PLACEMENT и
 * PLACEMENT_OPTIONS в теле; страницы Next ждут GET, поэтому парсим форму
 * и делаем 303-редирект на /widget/message, перенося query-параметры —
 * они (DOMAIN, APP_SID и т.д.) нужны @bitrix24/b24jssdk для авторизации.
 */

const PLACEMENT_ENTITY: Record<string, "deal" | "contact"> = {
  CRM_DEAL_DETAIL_TAB: "deal",
  CRM_CONTACT_DETAIL_TAB: "contact",
};

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const target = new URL("/widget/message", url.origin);
  url.searchParams.forEach((value, key) => {
    target.searchParams.set(key, value);
  });

  if (request.method === "POST") {
    const form = await request.formData().catch(() => null);
    const placement = String(form?.get("PLACEMENT") ?? "");
    const entity = PLACEMENT_ENTITY[placement];
    if (entity) target.searchParams.set("entity", entity);

    try {
      const options = JSON.parse(
        String(form?.get("PLACEMENT_OPTIONS") ?? "{}"),
      ) as { ID?: string | number };
      if (options.ID) target.searchParams.set("id", String(options.ID));
    } catch {
      // PLACEMENT_OPTIONS не JSON — страница покажет «откройте из карточки»
    }
  }

  return NextResponse.redirect(target, 303);
}

export const POST = handle;
export const GET = handle;
