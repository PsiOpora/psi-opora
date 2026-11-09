import { SITE_CODES } from "./site-codes";
import { decodeStartParam, splitStartParam, type UtmParams } from "./utm";

export interface MarketingCampaignRef {
	/** Кодовое слово в том регистре, в каком оно сохранено в дашборде. */
	code: string;
}

export type FindMarketingCampaign = (
	code: string,
) => Promise<MarketingCampaignRef | null>;

/**
 * Метки из start-параметра вида `FREE` или `FREE_vk` для маркетинговой
 * кампании из дашборда: UTM_CAMPAIGN = кодовое слово, UTM_SOURCE = площадка
 * после первого «_». Сценарий бота при этом обычный — кампания только
 * размечает трафик. Служебные коды из SITE_CODES проверяются раньше, чтобы
 * их нельзя было перекрыть кампанией. Возвращает null, если параметр не
 * относится ни к одной кампании.
 */
export async function matchMarketingStart(
	startParam: string | undefined,
	find: FindMarketingCampaign,
): Promise<UtmParams | null> {
	if (!startParam) return null;
	const decoded = decodeStartParam(startParam) ?? startParam;
	if (decoded in SITE_CODES) return null;

	const direct = await find(decoded);
	if (direct) return { campaign: direct.code };

	const { keyword, source } = splitStartParam(decoded);
	if (!source) return null;
	const campaign = await find(keyword);
	return campaign ? { campaign: campaign.code, source } : null;
}
