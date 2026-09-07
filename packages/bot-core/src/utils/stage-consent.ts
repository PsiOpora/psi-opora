/**
 * Согласия (оферта / рекламная рассылка), которые бот запрашивает отдельными
 * сообщениями, когда сделка попадает в стадию «Б/п консультация» — не часть
 * машины состояний сценария (см. scenario/engine.ts), а отдельный триггер по
 * CRM (packages/jobs/src/stage-consent.ts шлёт сообщения, эти хелперы читает
 * и пишет обработчик нажатия кнопки в apps/tg-bot и apps/max-bot).
 *
 * Сделка, которой адресован клик, передаётся в callback_data и одновременно
 * хранится в Redis по ключу мессенджер+userId. Обработчик принимает клик только
 * когда оба идентификатора совпадают — кнопка от старой сделки не может
 * записать согласие в новую.
 */

import type { ScenarioTexts } from "../scenario/texts";
import type { RedisClient } from "../storage/redis";
import { setDealConsentTimestamp } from "./bitrix/sources";

export const STAGE_CONSENT_ACTIONS = [
	"stage_offer_agree",
	"stage_ads_agree",
	"stage_ads_decline",
] as const;
export type StageConsentAction = (typeof STAGE_CONSENT_ACTIONS)[number];

const STAGE_CONSENT_ACTION_LABEL_KEYS: Record<
	StageConsentAction,
	keyof ScenarioTexts
> = {
	stage_offer_agree: "btn_stage_consent_offer_agree",
	stage_ads_agree: "btn_stage_consent_ads_agree",
	stage_ads_decline: "btn_stage_consent_ads_decline",
};

export interface StageConsentInlineButton {
	label: string;
	action: string;
}

export function stageConsentActionLabel(
	action: StageConsentAction,
	texts: ScenarioTexts,
): string {
	return texts[STAGE_CONSENT_ACTION_LABEL_KEYS[action]];
}

export function stageConsentPayload(
	action: StageConsentAction,
	dealId: number,
): string {
	return `${action}:${dealId}`;
}

export function parseStageConsentPayload(
	value: string,
): { action: StageConsentAction; dealId: number } | null {
	const separator = value.lastIndexOf(":");
	if (separator <= 0) return null;
	const action = value.slice(0, separator);
	const dealIdText = value.slice(separator + 1);
	if (!isStageConsentAction(action) || !/^\d+$/.test(dealIdText)) return null;
	const dealId = Number(dealIdText);
	return Number.isSafeInteger(dealId) && dealId > 0 ? { action, dealId } : null;
}

/** Общая клавиатура для Telegram, MAX и фоновой отправки триггера. */
export function toInlineKeyboard(
	actions: readonly StageConsentAction[],
	dealId: number,
	texts: ScenarioTexts,
): StageConsentInlineButton[][] {
	return [
		actions.map((action) => ({
			label: stageConsentActionLabel(action, texts),
			action: stageConsentPayload(action, dealId),
		})),
	];
}

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

const REMOVE_PENDING_DEAL_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

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

/** Удаляет только ожидаемую сделку, не затрагивая более новую привязку. */
export async function removePendingStageDeal(
	redis: RedisClient,
	messenger: string,
	userId: number | string,
	dealId: number,
): Promise<boolean> {
	const removed = await redis.eval(
		REMOVE_PENDING_DEAL_SCRIPT,
		[pendingDealKey(messenger, userId)],
		[dealId],
	);
	return Number(removed) === 1;
}

/** Пишет дату/время согласия в сделку — без ручного заполнения оператором. */
export async function recordStageConsent(
	redis: RedisClient,
	messenger: string,
	dealId: number,
	field: string,
): Promise<void> {
	await setDealConsentTimestamp(
		redis,
		messenger,
		dealId,
		field,
		new Date().toISOString(),
	);
}

function completedConsentsKey(dealId: number): string {
	return `stage-consent:completed:${dealId}`;
}

async function markConsentCompleted(
	redis: RedisClient,
	messenger: string,
	userId: number | string,
	dealId: number,
	action: StageConsentAction,
): Promise<void> {
	if (action === "stage_ads_decline") return;
	const key = completedConsentsKey(dealId);
	await redis.sadd(key, action === "stage_offer_agree" ? "offer" : "ads");
	await redis.expire(key, PENDING_TTL_SECONDS);
	const completed = await redis.smembers<string>(key);
	if (completed.includes("offer") && completed.includes("ads")) {
		await removePendingStageDeal(redis, messenger, userId, dealId);
		await redis.del(key);
	}
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
	dealId: number,
	action: StageConsentAction,
	texts: ScenarioTexts,
): Promise<StageConsentClickResult | null> {
	const pendingDealId = await getPendingStageDeal(redis, messenger, userId);
	if (pendingDealId !== dealId) return null;

	if (action === "stage_offer_agree") {
		await recordStageConsent(redis, messenger, dealId, CONSENT_OFFER_FIELD);
		await markConsentCompleted(redis, messenger, userId, dealId, action);
		return {
			replyText: texts.stage_consent_offer_agreed,
			resendAdsQuestion: false,
		};
	}

	if (action === "stage_ads_agree") {
		await recordStageConsent(redis, messenger, dealId, CONSENT_ADS_FIELD);
		await markConsentCompleted(redis, messenger, userId, dealId, action);
		return {
			replyText: texts.stage_consent_ads_agreed,
			resendAdsQuestion: false,
		};
	}

	await recordStageConsent(
		redis,
		messenger,
		dealId,
		CONSENT_ADS_DECLINED_FIELD,
	);
	const shouldRetry = await claimAdsRetry(redis, dealId);
	return {
		replyText: texts.stage_consent_ads_declined,
		resendAdsQuestion: shouldRetry,
	};
}
