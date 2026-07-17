/**
 * Общая логика завершения воронки консультации:
 * получение chatId из Redis → создание сделки в Bitrix → трекинг шага "deal".
 *
 * Используется в TG и MAX ботах.
 */

import { createUpstashRedis, getBitrixChatInfo } from "../storage/upstash";
import { createBitrixDeal, type DealData } from "./bitrix";
import { type FunnelEventContext, trackFunnelStep } from "./funnel";

// Ленивый синглтон Redis — инициализируется при первом вызове.
let _redis: ReturnType<typeof createUpstashRedis> | null = null;
function getRedis() {
  if (!_redis) {
    try {
      _redis = createUpstashRedis();
    } catch {
      return null;
    }
  }
  return _redis;
}

export interface SubmitDealParams {
  name: string;
  phone: string;
  email?: string;
  messenger: string;
  /** user_id мессенджера — используется для lookup chatId в Redis */
  userId?: number;
  source?: string;
  campaign?: string;
  /** Комментарий к сделке (например, выбранные в сценарии категория и тема). */
  comment?: string;
}

/**
 * Создаёт сделку в Bitrix24 и трекает шаг "deal" в воронке.
 * Ошибки Bitrix не пробрасываются — логируются и поглощаются,
 * чтобы не ломать диалог с клиентом.
 *
 * @returns ID созданной сделки, null при ошибке или отключённом Bitrix
 */
export async function submitConsultationDeal(
  params: SubmitDealParams,
): Promise<number | null> {
  const { name, phone, email, messenger, userId, source, campaign, comment } =
    params;

  const funnelCtx: FunnelEventContext = { messenger, source, campaign };

  try {
    let chatId: number | undefined;
    let operatorId: number | undefined;

    const redis = getRedis();
    if (redis && userId) {
      const chatInfo = await getBitrixChatInfo(redis, userId);
      if (chatInfo) {
        chatId = chatInfo.chatId;
        operatorId = chatInfo.operatorId || undefined;
        console.log(
          `[deal] найден chatId=${chatId} для userId=${userId} messenger=${messenger}`,
        );
      }
    }

    const dealData: DealData = {
      name,
      phone,
      ...(email ? { email } : {}),
      campaign,
      source,
      telegramUserId: userId,
      messenger,
      ...(comment ? { comment } : {}),
      ...(chatId !== undefined ? { chatId } : {}),
      ...(operatorId !== undefined ? { operatorId } : {}),
    };

    const { dealId } = await createBitrixDeal(dealData);
    await trackFunnelStep("deal", funnelCtx);
    return dealId || null;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[bitrix] ошибка создания сделки (${messenger}): ${message}`);
    return null;
  }
}
