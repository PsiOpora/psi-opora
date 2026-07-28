import {
  createBitrixSessionToken,
  DASHBOARD_SESSION_COOKIE,
  verifyAndSavePortalTokens,
} from "@psi-opora/bitrix-client";
import { NextResponse } from "next/server";
import { MEMBER_ID_COOKIE } from "@/lib/bitrix/session";

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
 * в Redis и привязывает браузер к порталу через cookie.
 */
export async function POST(request: Request) {
  const body: unknown = await request.json();
  if (!isValidPayload(body)) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  try {
    const verified = await verifyAndSavePortalTokens(
      { ...body, scope: body.scope ?? "" },
      "dashboard",
    );
    const token = createBitrixSessionToken({
      app: "dashboard",
      memberId: verified.tokens.memberId,
      userId: verified.userId,
      domain: verified.tokens.domain,
    });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(DASHBOARD_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
      maxAge: 60 * 60 * 8,
    });
    response.cookies.set(MEMBER_ID_COOKIE, verified.tokens.memberId, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
      maxAge: 60 * 60 * 8,
    });
    return response;
  } catch {
    return NextResponse.json(
      { error: "invalid bitrix session" },
      { status: 401 },
    );
  }
}
