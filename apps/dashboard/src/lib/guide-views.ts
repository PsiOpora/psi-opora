import { GUIDE_VIEW_PARAM, GUIDE_VIEW_SOURCE_PARAM } from "@psi-opora/bot-core";
import { recordBotGuideView } from "@psi-opora/db/queries";

/**
 * Агенты, которые тянут PDF сами: генератор превью ссылки в мессенджере,
 * поисковый краулер, проверка ссылки антивирусом. Это не просмотр клиента,
 * иначе «открыли материал» начнёт расти без участия людей. Названия
 * мессенджеров сюда специально не попали — их встроенные браузеры ходят под
 * обычным Chrome/Safari UA, а превьюшник Telegram отсекается по `bot`.
 */
const MACHINE_UA_RE =
  /bot\b|crawler|spider|preview|curl|wget|python-requests|node-fetch|undici|facebookexternalhit|slackbot/i;

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || null;
  return request.headers.get("x-real-ip");
}

/** Есть ли в ссылке токен просмотра — от этого зависит и кеширование ответа. */
export function hasGuideViewToken(request: Request): boolean {
  return new URL(request.url).searchParams.has(GUIDE_VIEW_PARAM);
}

/**
 * Фиксирует открытие материала, если запрос пришёл по персональной ссылке из
 * чата (см. buildGuideTrackingUrl). Ошибки только логируем: раздача PDF
 * важнее статистики.
 */
export async function trackGuideOpen(request: Request): Promise<void> {
  const params = new URL(request.url).searchParams;
  const token = params.get(GUIDE_VIEW_PARAM);
  if (!token) return;

  const userAgent = request.headers.get("user-agent");
  if (userAgent && MACHINE_UA_RE.test(userAgent)) return;

  try {
    const view = await recordBotGuideView(token, {
      source: params.get(GUIDE_VIEW_SOURCE_PARAM) ?? "chat",
      ip: clientIp(request),
      userAgent,
    });
    if (view?.recorded) {
      console.log(
        `[guide] материал открыт messenger=${view.messenger} user=${view.userId} campaign=${view.campaignId}`,
      );
    }
  } catch (err) {
    console.error(
      `[guide] не удалось записать открытие: ${(err as Error).message}`,
    );
  }
}
