/**
 * Согласия (оферта / рекламная рассылка), которые бот запрашивает отдельными
 * сообщениями, когда сделка попадает в стадию «Б/п консультация» — не часть
 * машины состояний сценария (см. scenario/engine.ts), а отдельный триггер по
 * CRM (packages/jobs/src/stage-consent.ts шлёт сообщения, эти хелперы читает
 * и пишет обработчик нажатия кнопки в apps/tg-bot и apps/max-bot).
 *
 * Сделка, которой адресован клик, не передаётся в callback_data (в MAX SDK
 * это неудобно), а хранится в Redis по ключу мессенджер+userId — на клиента
 * в любой момент приходится не больше одного активного триггера этой стадии.
 */
import type { RedisClient } from "../storage/redis";
import type { ScenarioTexts } from "../scenario/texts";
import { setDealConsentTimestamp } from "./bitrix";

export const STAGE_CONSENT_ACTIONS = [
	"stage_offer_agree",
	"stage_ads_agree",
	"stage_ads_decline",
] as const;
export type StageConsentAction = (typeof STAGE_CONSENT_ACTIONS)[number];

export function isStageConsentAction(
	value: string,
): value is StageConsentAction {
	return (STAGE_CONSENT_ACTIONS as readonly string[]).includes(value);
}

export const CONSENT_OFFER_FIELD = "UF_CRM_CONSENT_OFFER_DT";
export const CONSENT_ADS_FIELD = "UF_CRM_CONSENT_ADS_DT";
export const CONSENT_ADS_DECLINED_FIELD = "UF_CRM_CONSENT_ADS_DECLINED_DT";

const PENDING_TTL_SECONDS = 30 * 24 * 60 * 60;

function pendingDealKey(messenger: string, userId: number | string): string {
	return `stage-consent:pending:${messenger}:${userId}`;
}

/** Запоминает сделку, которой адресованы сообщения-триггеры — до этого
 * момента для пользователя не было активного запроса согласия этой стадии. */
export async function setPendingStageDeal(
	redis: RedisClient,
	messenger: string,
	userId: number | string,
	dealId: number,
): Promise<void> {
	await redis.set(pendingDealKey(messenger, userId), dealId, {
		ex: PENDING_TTL_SECONDS,
	});
}

export async function getPendingStageDeal(
	redis: RedisClient,
	messenger: string,
	userId: number | string,
): Promise<number | null> {
	const value = await redis.get<number>(pendingDealKey(messenger, userId));
	return value && value > 0 ? value : null;
}

/** Пишет дату/время согласия в сделку — без ручного заполнения оператором. */
export async function recordStageConsent(
	messenger: string,
	dealId: number,
	field: string,
): Promise<void> {
	await setDealConsentTimestamp(messenger, dealId, field, new Date().toISOString());
}

function adsRetryKey(dealId: number): string {
	return `stage-consent:ads-retried:${dealId}`;
}

const ADS_RETRY_TTL_SECONDS = 30 * 24 * 60 * 60;

/** true — это первый отказ от рассылки на этой сделке, стоит переспросить
 * ещё раз (единственный повторный триггер из ТЗ). false — уже переспрашивали. */
async function claimAdsRetry(
	redis: RedisClient,
	dealId: number,
): Promise<boolean> {
	const result = await redis.set(adsRetryKey(dealId), true, {
		ex: ADS_RETRY_TTL_SECONDS,
		nx: true,
	});
	return result === "OK";
}

export interface StageConsentClickResult {
	/** Текст, который бот отвечает сразу на нажатие. */
	replyText: string;
	/** Согласие на рассылку отклонено впервые — переспросить тем же
	 * сообщением с кнопками (см. claimAdsRetry). */
	resendAdsQuestion: boolean;
}

/**
 * Обрабатывает нажатие кнопки согласия стадии «Б/п консультация»: пишет
 * дату/время в сделку и решает, нужно ли переспросить про рассылку.
 * Кнопка от устаревшего/чужого сообщения (сделки уже нет в Redis) —
 * возвращает null, вызывающая сторона просто игнорирует клик.
 */
export async function handleStageConsentClick(
	redis: RedisClient,
	messenger: string,
	userId: number | string,
	action: StageConsentAction,
	texts: ScenarioTexts,
): Promise<StageConsentClickResult | null> {
	const dealId = await getPendingStageDeal(redis, messenger, userId);
	if (!dealId) return null;

	if (action === "stage_offer_agree") {
		await recordStageConsent(messenger, dealId, CONSENT_OFFER_FIELD);
		return {
			replyText: texts.stage_consent_offer_agreed,
			resendAdsQuestion: false,
		};
	}

	if (action === "stage_ads_agree") {
		await recordStageConsent(messenger, dealId, CONSENT_ADS_FIELD);
		return {
			replyText: texts.stage_consent_ads_agreed,
			resendAdsQuestion: false,
		};
	}

	await recordStageConsent(messenger, dealId, CONSENT_ADS_DECLINED_FIELD);
	const shouldRetry = await claimAdsRetry(redis, dealId);
	return {
		replyText: texts.stage_consent_ads_declined,
		resendAdsQuestion: shouldRetry,
	};
}
