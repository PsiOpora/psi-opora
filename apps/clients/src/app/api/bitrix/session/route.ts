import { MEMBER_ID_COOKIE } from "@psi-opora/bitrix-client";
import { NextResponse } from "next/server";

/**
 * Привязывает браузер к порталу Битрикс24 через cookie с member_id.
 *
 * В отличие от apps/dashboard, OAuth-токены здесь НЕ сохраняем: приложение
 * «Диалоги» зарегистрировано на портале отдельным локальным приложением со
 * своим client_id, и если бы оба писали токены под общий ключ
 * `bitrix24:dashboard:portal:{memberId}`, они бы затирали друг друга (refresh
 * чужого токена с creds дашборда падает с invalid_client). Все серверные
 * REST-вызовы идут по токенам, которые сохраняет dashboard — он должен быть
 * установлен на том же портале.
 */
export async function POST(request: Request) {
  const body: unknown = await request.json();
  const memberId =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).memberId
      : undefined;
  if (typeof memberId !== "string" || memberId.length === 0) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(MEMBER_ID_COOKIE, memberId, {
    httpOnly: true,
    secure: true,
    // Приложение открывается во фрейме на другом домене (портал Битрикс24),
    // поэтому cookie обязательно должна быть SameSite=None.
    sameSite: "none",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
  return response;
}
