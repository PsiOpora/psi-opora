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
}

/**
 * Создаёт сделку в Bitrix24 и трекает шаг "deal" в воронке.
 * Ошибки Bitrix не пробрасываются — логируются и поглощаются,
 * чтобы не ломать диалог с клиентом.
 *
 * @returns true если сделка создана успешно, false при ошибке
 */
export async function submitConsultationDeal(
  params: SubmitDealParams,
): Promise<boolean> {
  const { name, phone, email, messenger, userId, source, campaign } = params;

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
      ...(chatId !== undefined ? { chatId } : {}),
      ...(operatorId !== undefined ? { operatorId } : {}),
    };

    await createBitrixDeal(dealData);
    await trackFunnelStep("deal", funnelCtx);
    return true;
  } catch (err: any) {
    console.error(
      `[bitrix] ошибка создания сделки (${messenger}): ${err.message}`,
    );
    return false;
  }
}
