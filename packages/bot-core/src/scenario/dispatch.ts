import {
  markBotMessageGuideEmailSent,
  upsertBotGuideDelivery,
} from "@psi-opora/db/queries";
import type { RedisClient } from "../storage/redis";
import { appendDealComment } from "../utils/bitrix";
import {
  submitBitrixContact,
  submitConsultationDeal,
} from "../utils/consultation-deal";
import { sendGuideEmail } from "../utils/email";
import { trackFunnelStep } from "../utils/funnel";
import { logBotMessage } from "../utils/message-log";
import {
  describeLead,
  type GuideCampaignContext,
  type ScenarioMessage,
  type ScenarioOutput,
} from "./engine";
import { clearScenarioAwaiting, markScenarioAwaiting } from "./reminders";
import { resolveGuideFile, type ScenarioTexts } from "./texts";

export interface ScenarioDispatchDeps {
  messenger: string;
  /** Ключ сессии в storage: chat id (TG) / user id (MAX). */
  sessionKey: string;
  /** Redis для регистрации напоминаний; без него напоминания отключены. */
  redis?: RedisClient | null;
  sendMessage: (message: ScenarioMessage) => Promise<void>;
  texts: ScenarioTexts;
  /** Имя из профиля мессенджера — попадает в сделку. */
  userName?: string;
  userId?: number;
  /** Внешний ID чата (тот же, что передаётся в imconnector.send.messages
   * как chat.id) — нужен для привязки сделки к диалогу Открытой линии. */
  chatId?: number;
  source?: string;
  campaign?: string;
  /** Данные кампании гайда при out.state.campaignId — переопределяет тему/текст письма и фиксирует выдачу. */
  guideCampaign?: GuideCampaignContext | null;
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
    const guide = message.guide
      ? await resolveGuideFile(message.guideId)
      : null;

    // Telegram не шлёт PDF отдельным документом (см. sendTelegramScenarioMessage) —
    // для гайда конкретной кампании (message.guideId) добавляем прямую
    // ссылку прямо в текст, иначе клиент видит только «сейчас отправим на
    // почту» и не может открыть материал сразу с телефона (см. исходное
    // ТЗ — «бот выдачи материала»). Для глобального гайда (без guideId)
    // поведение прежнее — только email, чтобы не менять давно живущий флоу.
    const outgoing =
      guide && message.guideId && deps.messenger === "telegram"
        ? {
            ...message,
            text: `${message.text}\n\n📄 [Открыть материал](${guide.url})`,
          }
        : message;

    try {
      await deps.sendMessage(outgoing);
    } catch (err) {
      // Отправка не удалась (клиент заблокировал бота, чат удалён) — сам факт
      // попытки всё равно должен остаться в истории со статусом "failed",
      // иначе шаг сценария пропадает бесследно. Исключение пробрасываем
      // дальше: сессию на упавшей отправке двигать нельзя.
      await logBotMessage({
        messenger: deps.messenger,
        userId: deps.userId,
        direction: "out",
        source: "scenario",
        text: outgoing.text,
        status: "failed",
      });
      throw err;
    }
    const messageId = await logBotMessage({
      messenger: deps.messenger,
      userId: deps.userId,
      direction: "out",
      source: "scenario",
      text: outgoing.text,
    });

    if (guide && out.state.email) {
      try {
        await sendGuideEmail(
          out.state.email,
          guide,
          deps.guideCampaign?.emailSubject ?? deps.texts.email_subject,
          deps.guideCampaign?.emailBody ?? deps.texts.email_body,
        );
        if (messageId) await markBotMessageGuideEmailSent(messageId);
      } catch (err) {
        // Гайд уже ушёл в чат — без письма диалог не ломаем
        console.error(
          `[guide] не удалось отправить email: ${(err as Error).message}`,
        );
      }
    }
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
      chatId: deps.chatId,
      source: deps.source,
      campaign: deps.campaign,
      comment: describeLead(out.lead, deps.texts, deps.guideCampaign?.title),
      flow: out.lead.flow,
      audience: out.lead.audience,
      issue: out.lead.issue,
    });
    // Мутируем state по ссылке: адаптер уже положил его в сессию,
    // и сессия сохранится после завершения обработчика
    if (dealId) out.state.dealId = dealId;

    // Снимок выдачи для follow-up-джобы (packages/jobs) — она шлёт
    // напоминание через campaign.followUpDelayDays независимо от того,
    // жива ли ещё Redis-сессия сценария к тому моменту.
    if (out.lead.campaignId && deps.userId !== undefined) {
      await upsertBotGuideDelivery({
        campaignId: out.lead.campaignId,
        messenger: deps.messenger,
        userId: String(deps.userId),
        chatId: deps.chatId !== undefined ? String(deps.chatId) : undefined,
        dealId: dealId ?? undefined,
        name,
        phone: out.lead.phone,
        email: out.lead.email,
      });
    }
  }

  if (out.contact) {
    const contactId = await submitBitrixContact({
      name: deps.userName,
      email: out.contact.email,
      messenger: deps.messenger,
      telegramUserId: deps.userId,
      chatId: deps.chatId,
      source: deps.source,
      campaign: deps.campaign,
    });
    if (contactId) {
      console.log(
        `[SCENARIO] контакт создан id=${contactId} email=${out.contact.email} user=${deps.userId} messenger=${deps.messenger}`,
      );
    }
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
