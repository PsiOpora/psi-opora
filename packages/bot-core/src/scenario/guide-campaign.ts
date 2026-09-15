import {
	type BotGuideCampaign,
	getBotGuideCampaign,
	getBotGuideCampaignByKeyword,
	getPendingGuideDiagnosticDelivery,
	markGuideDiagnosticRequested,
} from "@psi-opora/db/queries";
import { appendDealComment } from "../utils/bitrix";
import { splitStartParam } from "../utils/utm";
import type { GuideCampaignContext } from "./engine";
import type { ScenarioTexts } from "./texts";

function toContext(row: BotGuideCampaign): GuideCampaignContext {
	return {
		id: row.id,
		keyword: row.keyword,
		title: row.title,
		guideId: row.guideId,
		welcomeMessage: row.welcomeMessage,
		emailQuestion: row.emailQuestion,
		emailSubject: row.emailSubject,
		emailBody: row.emailBody,
		deliveryMessage: row.deliveryMessage,
	};
}

/** Активная кампания по кодовому слову — null, если текст ему не соответствует. */
export async function findGuideCampaignByText(
	text: string,
): Promise<GuideCampaignContext | null> {
	const row = await getBotGuideCampaignByKeyword(text);
	return row ? toContext(row) : null;
}

export interface GuideCampaignStart {
	campaign: GuideCampaignContext;
	/** Источник рекламы из ссылки вида SCHOOL_VK — undefined, если его не было. */
	source?: string;
}

/**
 * Кампания по тексту, который может быть как голым кодовым словом
 * («SCHOOL» — набрано в чате или отдано мессенджером как /start-параметр),
 * так и словом с источником рекламы через `_` («SCHOOL_VK», см.
 * splitStartParam) — так дашборд собирает разные ссылки на одну кампанию
 * под разные площадки, не заводя кампанию под каждую отдельно.
 * Используется и для /start-параметра, и для кодового слова текстом в чате.
 */
export async function resolveGuideCampaignStart(
	text: string,
): Promise<GuideCampaignStart | null> {
	const direct = await findGuideCampaignByText(text);
	if (direct) return { campaign: direct };

	const { keyword, source } = splitStartParam(text);
	if (!source) return null;
	const campaign = await findGuideCampaignByText(keyword);
	return campaign ? { campaign, source } : null;
}

/**
 * Кампания по id из ScenarioState.campaignId — адаптер вызывает это на
 * каждом шаге активного сценария кампании (движок сам в БД не ходит).
 */
export async function loadGuideCampaignContext(
	campaignId: string,
): Promise<GuideCampaignContext | null> {
	const row = await getBotGuideCampaign(campaignId);
	return row ? toContext(row) : null;
}

const DIAGNOSTIC_CONSENT_RE =
	/соглас\w*.*диагностик\w*|диагностик\w*.*соглас\w*/i;

/**
 * Свободный текст похож на согласие на диагностику — клиента просят
 * написать в чат именно эту фразу (см. follow-up-сообщение кампании),
 * поэтому кроме кнопки принимаем и текст.
 */
export function looksLikeDiagnosticConsent(text: string): boolean {
	return DIAGNOSTIC_CONSENT_RE.test(text);
}

/**
 * Заявка на бесплатную диагностику после follow-up по кампании гайда:
 * фиксирует факт в bot_guide_deliveries и уведомляет менеджера комментарием
 * в существующей сделке (без неё — молча пропускает, заявки без сделки
 * никогда не бывает, см. dispatchScenarioOutput). Возвращает null, если для
 * этого пользователя нет ожидающей выдачи (кнопка от устаревшего/чужого
 * сообщения, повторный ответ и т.п.) — тогда адаптер ничего не отвечает.
 */
export async function handleGuideDiagnosticRequest(
	messenger: string,
	userId: string,
	t: ScenarioTexts,
): Promise<string | null> {
	const delivery = await getPendingGuideDiagnosticDelivery(messenger, userId);
	if (!delivery) return null;

	await markGuideDiagnosticRequested(delivery.id, delivery.dealId ?? undefined);

	if (delivery.dealId) {
		await appendDealComment(
			messenger,
			delivery.dealId,
			"Заявка на бесплатную диагностическую консультацию (после follow-up по гайду).",
		);
	}

	return t.guide_diagnostic_confirmed;
}
