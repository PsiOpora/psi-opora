import {
  insertBotMessage,
  listDueGuideFollowUps,
  markGuideFollowUpSent,
} from "@psi-opora/db/queries";
import { type Messenger, sendMessengerMessage } from "./messenger";

export interface SendGuideFollowUpsResult {
  sent: number;
  errors: number;
}

/**
 * Журнал сообщений: follow-up — такое же исходящее сообщение клиенту, как
 * сценарные напоминания, и должно быть видно в истории диалога со статусом
 * доставки ("failed" инбокс показывает как «не доставлено»). Ошибка записи не
 * должна ломать прогон рассылки follow-up'ов.
 */
async function logFollowUpMessage(params: {
  messenger: Messenger;
  userId: string;
  text: string;
  status: "sent" | "failed";
  externalId?: string;
}): Promise<void> {
  try {
    await insertBotMessage({
      messenger: params.messenger,
      userId: params.userId,
      direction: "out",
      source: "reminder",
      text: params.text,
      status: params.status,
      externalId: params.externalId,
    });
  } catch (err) {
    console.error(
      `[guide-follow-ups] не удалось записать сообщение в журнал: ${(err as Error).message}`,
    );
  }
}

/**
 * Follow-up по кампаниям гайдов: клиентам, получившим материал не менее
 * campaign.followUpDelayDays назад и ещё не получавшим напоминание,
 * отправляется campaign.followUpMessage с кнопкой записи на диагностику
 * (см. sc_guide_diagnostic в apps/tg-bot и apps/max-bot).
 */
export async function sendGuideFollowUps(): Promise<SendGuideFollowUpsResult> {
  const due = await listDueGuideFollowUps();
  let sent = 0;
  let errors = 0;

  for (const { delivery, campaign } of due) {
    const messenger = delivery.messenger as Messenger;
    try {
      const externalId = await sendMessengerMessage(
        messenger,
        delivery.userId,
        campaign.followUpMessage,
        [
          [
            {
              text: campaign.diagnosticCtaText,
              payload: "sc_guide_diagnostic",
            },
          ],
        ],
      );
      await logFollowUpMessage({
        messenger,
        userId: delivery.userId,
        text: campaign.followUpMessage,
        status: "sent",
        externalId,
      });
      await markGuideFollowUpSent(delivery.id);
      sent++;
    } catch (err) {
      errors++;
      await logFollowUpMessage({
        messenger,
        userId: delivery.userId,
        text: campaign.followUpMessage,
        status: "failed",
      });
      console.error(
        `[guide-follow-ups] delivery=${delivery.id} messenger=${delivery.messenger}: ${(err as Error).message}`,
      );
    }
  }

  return { sent, errors };
}
