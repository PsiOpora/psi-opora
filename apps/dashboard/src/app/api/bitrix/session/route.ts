import {
	createBitrixSessionToken,
	DASHBOARD_SESSION_COOKIE,
	savePortalTokens,
	verifyPortalAccessToken,
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
		typeof b.expiresAt === "number" &&
		typeof b.scope === "string"
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
		const portalTokens = { ...body, scope: body.scope ?? "" };
		const verified = await verifyPortalAccessToken(portalTokens);
		await savePortalTokens(portalTokens, "dashboard");
		const token = createBitrixSessionToken({
			app: "dashboard",
			memberId: portalTokens.memberId,
			userId: verified.userId,
			domain: portalTokens.domain,
		});
		const response = NextResponse.json({ ok: true });
		response.cookies.set(DASHBOARD_SESSION_COOKIE, token, {
			httpOnly: true,
			secure: true,
			sameSite: "none",
			path: "/",
			maxAge: 60 * 60 * 8,
		});
		response.cookies.set(MEMBER_ID_COOKIE, portalTokens.memberId, {
			httpOnly: true,
			secure: true,
			sameSite: "none",
			path: "/",
			maxAge: 60 * 60 * 8,
		});
		return response;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[dashboard/session] verification failed: ${message}`);
		const serverConfiguration =
			message.includes("не задан") || message.includes("некорректный домен");
		const code = serverConfiguration
			? "server_configuration"
			: message.includes("неизвестный портал")
				? "portal_mismatch"
				: message.includes("домен портала не совпадает")
					? "domain_mismatch"
					: message.includes("app.info")
						? "app_rejected"
						: message.includes("profile")
							? "token_rejected"
							: "oauth_rejected";
		return NextResponse.json(
			{
				error: serverConfiguration
					? "bitrix server configuration is incomplete"
					: "invalid bitrix session",
				code,
			},
			{ status: serverConfiguration ? 503 : 401 },
		);
	}
}
