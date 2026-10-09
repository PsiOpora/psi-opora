import {
	insertDealTouches,
	listAdTouchesForClient,
} from "@psi-opora/db/queries";
import { bitrixPost } from "../bitrix/client";
import { loadAdEntityNames } from "./ad-directory";
import {
	buildAttribution,
	collectEntityRefs,
	type DealAttribution,
} from "./build";

/** Окно атрибуции: касания старше этого срока заявку уже не объясняют. */
const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TOUCHES = 20;

export interface ResolveAttributionParams {
	ymClientId?: string;
	yclid?: string;
	/** Источник/кампания из самой ссылки на бота — запасной вариант. */
	source?: string;
	campaign?: string;
}

/**
 * Собирает атрибуцию сделки по касаниям клиента (ad_touches). Никогда не
 * бросает: без касаний или при сбое БД/Директа возвращает null — сделка
 * тогда создаётся по старой схеме (метка из start-параметра).
 */
export async function resolveDealAttribution(
	params: ResolveAttributionParams,
	now: Date = new Date(),
): Promise<DealAttribution | null> {
	if (!params.ymClientId && !params.yclid) return null;
	try {
		const touches = await listAdTouchesForClient({
			ymClientId: params.ymClientId,
			yclid: params.yclid,
			since: new Date(now.getTime() - LOOKBACK_MS),
			limit: MAX_TOUCHES,
		});
		if (touches.length === 0) return null;
		const names = await loadAdEntityNames(collectEntityRefs(touches), now);
		return buildAttribution({
			linkSource: params.source,
			linkCampaign: params.campaign,
			touches,
			names,
		});
	} catch (err) {
		console.error(
			`[attribution] не удалось собрать касания: ${(err as Error).message}`,
		);
		return null;
	}
}

/**
 * После создания сделки: фиксирует, какие касания в неё вошли (deal_touches),
 * и добавляет в таймлайн комментарий с цепочкой касаний. Ошибки только
 * логируются — сделка уже создана, ломать из-за аналитики диалог нельзя.
 */
export async function recordDealAttribution(params: {
	messenger: string;
	dealId: number;
	attribution: DealAttribution;
}): Promise<void> {
	const { messenger, dealId, attribution } = params;
	try {
		await insertDealTouches(
			String(dealId),
			attribution.touches.map((t) => ({ touchId: t.id, role: t.role })),
		);
	} catch (err) {
		console.error(
			`[attribution] не удалось сохранить касания сделки ${dealId}: ${(err as Error).message}`,
		);
	}
	try {
		await bitrixPost(
			"crm.timeline.comment.add",
			{
				fields: {
					ENTITY_ID: dealId,
					ENTITY_TYPE: "deal",
					COMMENT: attribution.timelineComment,
				},
			},
			messenger,
		);
	} catch (err) {
		console.error(
			`[attribution] не удалось добавить комментарий в таймлайн сделки ${dealId}: ${(err as Error).message}`,
		);
	}
}
