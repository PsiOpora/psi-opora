import type { NewAdTouch } from "@psi-opora/db/queries";
import { z } from "zod";

/**
 * Тело POST /api/track-touch (apps/bitrix-webhook): ключи совпадают с именами
 * параметров рекламной ссылки (utm_*, yclid, макросы Директа), чтобы скрипту
 * на сайте достаточно было переложить query-строку как есть. Значения —
 * строки без доверия: чистятся в normalizeTouchPayload.
 */
export const touchPayloadSchema = z.object({
	clientId: z.coerce.string().optional(),
	yclid: z.coerce.string().optional(),
	utm_source: z.string().optional(),
	utm_medium: z.string().optional(),
	utm_campaign: z.string().optional(),
	utm_content: z.string().optional(),
	utm_term: z.string().optional(),
	// Макросы Директа: {campaign_id}, {gbid}, {ad_id}, {phrase_id}.
	campaign_id: z.coerce.string().optional(),
	gbid: z.coerce.string().optional(),
	ad_id: z.coerce.string().optional(),
	phrase_id: z.coerce.string().optional(),
	landingUrl: z.string().optional(),
	referrer: z.string().optional(),
});

export type TouchPayload = z.infer<typeof touchPayloadSchema>;

const CLIENT_ID_RE = /^\d{10,25}$/;
const YCLID_RE = /^\d{10,25}$/;
const AD_ENTITY_ID_RE = /^\d{5,20}$/;
/** Тот же числовой хвост, что и в dashboard ad-spend-match: ID кампании в конце имени метки. */
const TRAILING_ID_RE = /(\d{6,20})$/;
const MAX_VALUE_LENGTH = 200;
const MAX_URL_LENGTH = 500;

/**
 * Пустое значение, нераскрытый макрос (`{keyword}`, `{{ad_id}}` — шаблон
 * ссылки без подстановки, например при открытии вручную) и управляющие
 * символы в метку попадать не должны.
 */
function cleanText(
	value: string | undefined,
	maxLength = MAX_VALUE_LENGTH,
): string | undefined {
	if (!value) return undefined;
	// biome-ignore lint/suspicious/noControlCharactersInRegex: сознательно вычищаем управляющие символы из недоверенного ввода
	const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
	if (!text || /\{[^}]*\}/.test(text)) return undefined;
	return text.slice(0, maxLength);
}

function cleanId(value: string | undefined, re: RegExp): string | undefined {
	const text = cleanText(value);
	return text && re.test(text) ? text : undefined;
}

/**
 * Приводит сырое тело к записи ad_touches. null — касание бесполезно для
 * атрибуции: нет ни ClientID, ни yclid (не к кому привязать) либо нет ни
 * одного рекламного признака (обычный заход без меток не хранится).
 */
export function normalizeTouchPayload(
	payload: TouchPayload,
	now: Date = new Date(),
): NewAdTouch | null {
	const ymClientId = cleanId(payload.clientId, CLIENT_ID_RE);
	const yclid = cleanId(payload.yclid, YCLID_RE);
	if (!ymClientId && !yclid) return null;

	let utmSource = cleanText(payload.utm_source)?.toLowerCase();
	let utmMedium = cleanText(payload.utm_medium)?.toLowerCase();
	const utmCampaign = cleanText(payload.utm_campaign);
	const utmContent = cleanText(payload.utm_content);
	const utmTerm = cleanText(payload.utm_term);

	// yclid присваивает только Директ при клике по объявлению — этого достаточно,
	// чтобы считать касание платным, даже если метки в ссылке потеряны.
	if (yclid && !utmSource) {
		utmSource = "yandex";
		utmMedium ??= "cpc";
	}

	const adCampaignId =
		cleanId(payload.campaign_id, AD_ENTITY_ID_RE) ??
		utmCampaign?.match(TRAILING_ID_RE)?.[1];
	const adId =
		cleanId(payload.ad_id, AD_ENTITY_ID_RE) ??
		(utmContent && AD_ENTITY_ID_RE.test(utmContent) ? utmContent : undefined);
	const adGroupId = cleanId(payload.gbid, AD_ENTITY_ID_RE);
	const keywordId = cleanId(payload.phrase_id, AD_ENTITY_ID_RE);

	if (!utmSource && !utmCampaign && !adId) return null;

	return {
		id: crypto.randomUUID(),
		ymClientId: ymClientId ?? null,
		yclid: yclid ?? null,
		utmSource: utmSource ?? null,
		utmMedium: utmMedium ?? null,
		utmCampaign: utmCampaign ?? null,
		utmContent: utmContent ?? null,
		utmTerm: utmTerm ?? null,
		adCampaignId: adCampaignId ?? null,
		adGroupId: adGroupId ?? null,
		adId: adId ?? null,
		keywordId: keywordId ?? null,
		landingUrl: cleanText(payload.landingUrl, MAX_URL_LENGTH) ?? null,
		referrer: cleanText(payload.referrer, MAX_URL_LENGTH) ?? null,
		occurredAt: now,
	};
}
