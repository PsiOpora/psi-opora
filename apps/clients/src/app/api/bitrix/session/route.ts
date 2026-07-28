import {
  CLIENTS_SESSION_COOKIE,
  createBitrixSessionToken,
  MEMBER_ID_COOKIE,
  verifyAndSavePortalTokens,
} from "@psi-opora/bitrix-client";
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
  if (!isValidPayload(body)) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  try {
    const verified = await verifyAndSavePortalTokens(
      {
        memberId: body.memberId,
        domain: body.domain,
        clientEndpoint: body.clientEndpoint,
        accessToken: body.accessToken,
        refreshToken: body.refreshToken,
        expiresAt: body.expiresAt,
        scope: body.scope,
      },
      "clients",
    );
    const token = createBitrixSessionToken({
      app: "clients",
      memberId: verified.tokens.memberId,
      userId: verified.userId,
      domain: verified.tokens.domain,
    });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(CLIENTS_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
      maxAge: 60 * 60 * 8,
    });
    // Удаляем прежнюю неподписанную cookie, чтобы она не выглядела сессией.
    response.cookies.set(MEMBER_ID_COOKIE, "", {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch {
    return NextResponse.json(
      { error: "invalid bitrix session" },
      { status: 401 },
    );
  }
}

interface SessionPayload {
  memberId: string;
  domain: string;
  clientEndpoint: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
}

function isValidPayload(body: unknown): body is SessionPayload {
  if (!body || typeof body !== "object") return false;
  const value = body as Record<string, unknown>;
  return (
    typeof value.memberId === "string" &&
    value.memberId.length > 0 &&
    value.memberId.length <= 128 &&
    typeof value.domain === "string" &&
    value.domain.length > 0 &&
    value.domain.length <= 255 &&
    typeof value.clientEndpoint === "string" &&
    typeof value.accessToken === "string" &&
    value.accessToken.length > 0 &&
    typeof value.refreshToken === "string" &&
    value.refreshToken.length > 0 &&
    typeof value.expiresAt === "number" &&
    typeof value.scope === "string"
  );
}
