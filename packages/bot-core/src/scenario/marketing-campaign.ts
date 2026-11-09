import { getMarketingCampaignByCode } from "@psi-opora/db/queries";
import { matchMarketingStart } from "../utils/marketing-start";
import { DB_TIMEOUT_MS, withTimeout } from "../utils/timeout";
import { parseUtmParams, type UtmParams } from "../utils/utm";

/**
 * UTM-метки для /start-параметра: сначала маркетинговые кампании дашборда
 * (`FREE_vk` → campaign=FREE, source=vk), затем служебные коды SITE_CODES и
 * запасной вариант «параметр как есть — кампания». БД недоступна — тихо
 * падаем на parseUtmParams, чтобы клиент в любом случае увидел сценарий.
 */
export async function resolveStartUtm(
	startParam: string | undefined,
): Promise<UtmParams> {
	try {
		const matched = await matchMarketingStart(startParam, (code) =>
			withTimeout(
				getMarketingCampaignByCode(code),
				DB_TIMEOUT_MS,
				"marketing_campaigns",
			),
		);
		if (matched) return matched;
	} catch (err) {
		console.error(
			`[marketing-campaign] не удалось найти кампанию: ${(err as Error).message}`,
		);
	}
	return parseUtmParams(startParam);
}
