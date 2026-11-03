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

type CompletedConsent = "offer" | "ads" | "ads_declined";

/**
 * Атомарно отмечает ответ на вопрос согласия в рамках сделки. false — этот
 * ответ уже был принят: повторное нажатие той же кнопки (в MAX кнопки
 * остаются под сообщением) не должно ни перезаписывать время согласия в
 * сделке, ни слать «Спасибо!» ещё раз.
 */
async function claimConsent(
	redis: RedisClient,
	dealId: number,
	consent: CompletedConsent,
): Promise<boolean> {
	const key = completedConsentsKey(dealId);
	const added = await redis.sadd(key, consent);
	await redis.expire(key, PENDING_TTL_SECONDS);
	return added > 0;
}

/** Пишет согласие в сделку; при сбое снимает отметку, чтобы клиент мог
 * нажать ещё раз. */
async function recordClaimedConsent(
	redis: RedisClient,
	messenger: string,
	dealId: number,
	consent: CompletedConsent,
	field: string,
): Promise<void> {
	try {
		await recordStageConsent(redis, messenger, dealId, field);
	} catch (error) {
		await redis.srem(completedConsentsKey(dealId), consent);
		throw error;
	}
}

async function releasePendingIfCompleted(
	redis: RedisClient,
	messenger: string,
	userId: number | string,
	dealId: number,
): Promise<void> {
	const key = completedConsentsKey(dealId);
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

	if (action === "stage_offer_agree" || action === "stage_ads_agree") {
		const consent = action === "stage_offer_agree" ? "offer" : "ads";
		if (!(await claimConsent(redis, dealId, consent))) return null;
		await recordClaimedConsent(
			redis,
			messenger,
			dealId,
			consent,
			consent === "offer" ? CONSENT_OFFER_FIELD : CONSENT_ADS_FIELD,
		);
		await releasePendingIfCompleted(redis, messenger, userId, dealId);
		return {
			replyText:
				consent === "offer"
					? texts.stage_consent_offer_agreed
					: texts.stage_consent_ads_agreed,
			resendAdsQuestion: false,
		};
	}

	// Отказ после уже данного согласия на рассылку — кнопка от старого
	// сообщения, игнорируем.
	const answered = await redis.smembers<string>(completedConsentsKey(dealId));
	if (answered.includes("ads")) return null;
	// Первый отказ — переспрашиваем; второй — окончательный, а всё, что
	// после него, — повторные нажатия.
	const shouldRetry = await claimAdsRetry(redis, dealId);
	if (!shouldRetry && !(await claimConsent(redis, dealId, "ads_declined"))) {
		return null;
	}
	await recordStageConsent(
		redis,
		messenger,
		dealId,
		CONSENT_ADS_DECLINED_FIELD,
	);
	return {
		replyText: texts.stage_consent_ads_declined,
		resendAdsQuestion: shouldRetry,
	};
}
