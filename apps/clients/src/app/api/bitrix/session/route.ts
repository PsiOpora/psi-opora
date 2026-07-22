import { MEMBER_ID_COOKIE, savePortalTokens } from "@psi-opora/bitrix-client";
import { NextResponse } from "next/server";

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
  const b = body as Record<string, unknown>;
  return (
    typeof b.memberId === "string" &&
    typeof b.domain === "string" &&
    typeof b.clientEndpoint === "string" &&
    typeof b.accessToken === "string" &&
    typeof b.refreshToken === "string" &&
    typeof b.expiresAt === "number"
  );
}

/**
 * Принимает авторизационные данные, полученные фронтендом от B24Frame
 * (@bitrix24/b24jssdk) при открытии приложения внутри Битрикс24, сохраняет их
 * в Redis и привязывает браузер к порталу через cookie. Копия
 * apps/dashboard/src/app/api/bitrix/session — токены общие (тот же Redis).
 */
export async function POST(request: Request) {
  const body: unknown = await request.json();
  if (!isValidPayload(body)) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  await savePortalTokens({
    memberId: body.memberId,
    domain: body.domain,
    clientEndpoint: body.clientEndpoint,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    expiresAt: body.expiresAt,
    scope: body.scope ?? "",
  });

  const response = NextResponse.json({ ok: true });
  response.cookies.set(MEMBER_ID_COOKIE, body.memberId, {
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
