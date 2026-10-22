"use client";

import { ApiVersion, type AuthData, type B24Frame } from "@bitrix24/b24jssdk";

/**
 * Сессия «Диалогов» — подписанная cookie на 8 часов (см. /api/bitrix/session).
 * Вкладка внутри Битрикс24 живёт дольше, поэтому при 401 сессию продлеваем
 * свежим токеном из фрейма, а не оставляем инбокс молча падать до перезагрузки.
 */

let sessionFrame: B24Frame | null = null;
let pendingRenewal: Promise<boolean> | null = null;

/** Обменивает OAuth-токен портала на cookie сессии; бросает при отказе. */
export async function establishBitrixSession(
	frame: B24Frame,
	authData: AuthData,
): Promise<void> {
	const clientEndpoint =
		frame.getTargetOriginWithPath().get(ApiVersion.v2) ??
		`https://${authData.domain}/rest/`;

	const res = await fetch("/api/bitrix/session", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			memberId: authData.member_id,
			domain: authData.domain,
			clientEndpoint,
			accessToken: authData.access_token,
			refreshToken: authData.refresh_token,
			expiresAt: authData.expires,
			scope: typeof authData.scope === "string" ? authData.scope : "",
		}),
	});
	if (!res.ok) throw new Error("Не удалось сохранить сессию Битрикс24");
}

/** Запоминает фрейм, через который продлевается сессия при 401. */
export function setSessionFrame(frame: B24Frame | null): void {
	sessionFrame = frame;
}

/**
 * Запрашивает у портала свежий токен и пересоздаёт cookie сессии.
 * Параллельные 401 (поллинг списка, треда, профиля) склеиваются в одно
 * продление. Возвращает false, если фрейма нет или портал отказал.
 */
export function renewBitrixSession(): Promise<boolean> {
	const frame = sessionFrame;
	if (!frame) return Promise.resolve(false);
	if (!pendingRenewal) {
		pendingRenewal = renew(frame).finally(() => {
			pendingRenewal = null;
		});
	}
	return pendingRenewal;
}

async function renew(frame: B24Frame): Promise<boolean> {
	try {
		const authData = await frame.auth.refreshAuth();
		await establishBitrixSession(frame, authData);
		return true;
	} catch (err) {
		console.warn("[clients/session] не удалось продлить сессию", err);
		return false;
	}
}

/**
 * `fetch`, который при 401 один раз продлевает сессию и повторяет запрос.
 * Тело `Request` клонируется заранее — после первой отправки оно прочитано.
 */
export async function fetchWithSessionRenewal(
	input: Request | string | URL,
	init?: RequestInit,
): Promise<Response> {
	const retryInput = input instanceof Request ? input.clone() : input;
	const res = await fetch(input, init);
	if (res.status !== 401) return res;
	if (!(await renewBitrixSession())) return res;
	return fetch(retryInput, init);
}
