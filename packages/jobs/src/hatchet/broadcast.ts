import {
  ConcurrencyLimitStrategy,
  CreateTaskWorkflow,
} from "@hatchet-dev/typescript-sdk/v1";
import { formatMessengerError } from "../messenger-errors";
import {
  type Messenger,
  SEND_INTERVAL_MS,
  sendMessengerMessage,
  sleep,
} from "../messenger";

export type DeliverBroadcastPayload = {
  broadcastId: string;
  /** initial — получатели в статусе pending; resend — досылка по ошибкам. */
  mode: "initial" | "resend";
};

export const deliverBroadcast = CreateTaskWorkflow({
  name: "broadcast-deliver",
  retries: 0,
  executionTimeout: "1h",
  scheduleTimeout: "24h",
  // Одна рассылка за раз: общий лимит сохраняет темп отправки при нескольких
  // репликах worker'а и при одновременной рассылке/досылке.
  concurrency: {
    expression: "'broadcast-deliver'",
    maxRuns: 1,
    limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
  },
  fn: async (payload: DeliverBroadcastPayload) => {
    // Ленивый импорт: клиент БД подключается на верхнем уровне модуля
    // (top-level await + проверка POSTGRES_URL), поэтому статический импорт
    // ронял бы индексацию задач при деплое, где БД недоступна.
    const {
      finishBroadcast,
      getBroadcast,
      insertBotMessage,
      listBroadcastRecipients,
      updateBroadcastRecipient,
    } = await import("@psi-opora/db/queries");

    const broadcast = await getBroadcast(payload.broadcastId);
    if (!broadcast) {
      throw new Error(`Рассылка ${payload.broadcastId} не найдена`);
    }

    const targetStatus = payload.mode === "resend" ? "error" : "pending";

    try {
      const targets = (
        await listBroadcastRecipients(payload.broadcastId)
      ).filter(
        (r) =>
          r.status === targetStatus &&
          (r.messenger === "telegram" || r.messenger === "max") &&
          r.messengerUserId,
      );

      for (const recipient of targets) {
        try {
          await sendMessengerMessage(
            recipient.messenger as Messenger,
            recipient.messengerUserId as string,
            broadcast.message,
          );
          await updateBroadcastRecipient(recipient.id, {
            status: "sent",
            error: null,
            sentAt: new Date(),
          });
          // Журнал сообщений — рассылка тоже должна быть видна в истории
          // диалога во вкладке CRM. Ошибка записи не должна валить рассылку.
          await insertBotMessage({
            messenger: recipient.messenger as Messenger,
            userId: recipient.messengerUserId as string,
            direction: "out",
            source: "broadcast",
            text: broadcast.message,
          }).catch((err: unknown) => {
            console.error(
              `[broadcast] не удалось записать сообщение в журнал: ${(err as Error).message}`,
            );
          });
        } catch (err) {
          await updateBroadcastRecipient(recipient.id, {
            status: "error",
            error: formatMessengerError((err as Error).message),
            sentAt: null,
          });
        }
        await sleep(SEND_INTERVAL_MS);
      }

      const final = await listBroadcastRecipients(payload.broadcastId);
      const sent = final.filter((r) => r.status === "sent").length;
      const skipped = final.filter((r) => r.status === "skipped").length;
      const failed = final.filter((r) => r.status === "error").length;

      await finishBroadcast(payload.broadcastId, {
        status: "done",
        sentCount: sent,
        skippedCount: skipped,
        failedCount: failed,
      });

      return { sent, skipped, failed, mode: payload.mode };
    } catch (err) {
      await finishBroadcast(payload.broadcastId, {
        status: "error",
        error: (err as Error).message,
      });
      throw err;
    }
  },
});
