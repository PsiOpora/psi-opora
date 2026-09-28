import { getPortalTokens } from "@psi-opora/bitrix-client";
import { env } from "@psi-opora/config";

/**
 * Домен портала для прямых ссылок на карточки CRM: из OAuth-токенов портала,
 * в вебхук-режиме (локальная разработка) — из хоста DASHBOARD_BITRIX_WEBHOOK_URL.
 */
export async function resolvePortalDomain(
	memberId: string | null,
): Promise<string | null> {
	if (memberId) {
		const tokens = await getPortalTokens(memberId).catch(() => undefined);
		if (tokens) return tokens.domain;
	}
	if (env.DASHBOARD_BITRIX_WEBHOOK_URL) {
		try {
			return new URL(env.DASHBOARD_BITRIX_WEBHOOK_URL).host;
		} catch {
			return null;
		}
	}
	return null;
}

export function crmUrl(
	domain: string | null,
	entity: "contact" | "deal" | "lead",
	id: string,
): string | null {
	if (!domain) return null;
	const origin = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
	return `${origin.replace(/\/$/, "")}/crm/${entity}/details/${id}/`;
}
