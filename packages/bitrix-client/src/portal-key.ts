import { bitrixPortalKey, env } from "@psi-opora/config";
import { getPortalTokens } from "./tokens";

/** Resolve the actual portal; never substitute another portal's dev webhook. */
export async function resolveBitrixPortalKey(
	memberId: string | null,
): Promise<string> {
	if (memberId) {
		const tokens = await getPortalTokens(memberId);
		if (tokens) return bitrixPortalKey(tokens.domain);
	} else if (
		env.NODE_ENV !== "production" &&
		env.DASHBOARD_BITRIX_WEBHOOK_URL
	) {
		return bitrixPortalKey(env.DASHBOARD_BITRIX_WEBHOOK_URL);
	}
	throw new Error("Cannot resolve Bitrix portal key");
}
