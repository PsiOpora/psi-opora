import { cookies } from "next/headers";
import { env } from "@psi-opora/config";
import { getPortalTokens } from "@/lib/bitrix/tokens";
import { MEMBER_ID_COOKIE } from "./session";

/**
 * Домен портала для прямых ссылок на карточки CRM. В режиме OAuth берём его
 * из сохранённых токенов портала, в режиме вебхука (локальная разработка) —
 * из хоста DASHBOARD_BITRIX_WEBHOOK_URL. Server-only (next/headers) — для
 * ссылки внутри клиентских компонентов используйте dealUrl из "@/lib/deal-url".
 */
export async function getBitrixPortalDomain(): Promise<string | null> {
	const store = await cookies();
	const memberId = store.get(MEMBER_ID_COOKIE)?.value ?? null;
	if (memberId) {
		const tokens = await getPortalTokens(memberId);
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
