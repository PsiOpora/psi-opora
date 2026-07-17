import type { Redis } from "@upstash/redis";
import { appendDealComment } from "../utils/bitrix";
import { submitConsultationDeal } from "../utils/consultation-deal";
import { trackFunnelStep } from "../utils/funnel";
import { logBotMessage } from "../utils/message-log";
import {
  describeLead,
  type ScenarioMessage,
  type ScenarioOutput,
} from "./engine";
import { clearScenarioAwaiting, markScenarioAwaiting } from "./reminders";
import type { ScenarioTexts } from "./texts";

export interface ScenarioDispatchDeps {
  messenger: string;
  /** Ключ сессии в storage: chat id (TG) / user id (MAX). */
  sessionKey: string;
  /** Redis для регистрации напоминаний; без него напоминания отключены. */
  redis?: Redis | null;
  sendMessage: (message: ScenarioMessage) => Promise<void>;
  texts: ScenarioTexts;
  /** Имя из профиля мессенджера — попадает в сделку. */
  userName?: string;
  userId?: number;
  source?: string;
  campaign?: string;
}

/**
 * Исполняет результат шага сценария: отправляет сообщения, трекает воронку,
 * создаёт сделку в Bitrix и управляет очередью напоминаний.
 */
export async function dispatchScenarioOutput(
  out: ScenarioOutput,
  deps: ScenarioDispatchDeps,
): Promise<void> {
  for (const message of out.messages) {
    await deps.sendMessage(message);
    await logBotMessage({
      messenger: deps.messenger,
      userId: deps.userId,
      direction: "out",
      source: "scenario",
      text: message.text,
    });
  }

  for (const step of out.track) {
    await trackFunnelStep(step, {
      messenger: deps.messenger,
      source: deps.source,
      campaign: deps.campaign,
    });
  }

  if (out.lead) {
    // Имя из анкеты (флоу консультации) точнее имени из профиля мессенджера
    const name =
      out.lead.name?.trim() || deps.userName?.trim() || "Клиент из бота";
    console.log(
      `[SCENARIO] заявка flow=${out.lead.flow} name=${name} phone=${out.lead.phone}${out.lead.email ? ` email=${out.lead.email}` : ""}${out.lead.audience ? ` audience=${out.lead.audience}` : ""}${out.lead.issue ? ` issue=${out.lead.issue}` : ""} user=${deps.userId} messenger=${deps.messenger}`,
    );
    const dealId = await submitConsultationDeal({
      name,
      phone: out.lead.phone,
      email: out.lead.email,
      messenger: deps.messenger,
      userId: deps.userId,
      source: deps.source,
      campaign: deps.campaign,
      comment: describeLead(out.lead, deps.texts),
    });
    // Мутируем state по ссылке: адаптер уже положил его в сессию,
    // и сессия сохранится после завершения обработчика
    if (dealId) out.state.dealId = dealId;
  }

  if (out.subscribeChoice && out.state.dealId) {
    await appendDealComment(
      deps.messenger,
      out.state.dealId,
      `Согласие на рассылку: ${out.subscribeChoice === "yes" ? "да" : "нет"}`,
    );
  }

  if (deps.redis) {
    try {
      if (out.awaitingInput) {
        await markScenarioAwaiting(deps.redis, deps.messenger, deps.sessionKey);
      } else {
        await clearScenarioAwaiting(
          deps.redis,
          deps.messenger,
          deps.sessionKey,
        );
      }
    } catch (err) {
      console.error(
        `[scenario] не удалось обновить очередь напоминаний: ${(err as Error).message}`,
      );
    }
  }
}
