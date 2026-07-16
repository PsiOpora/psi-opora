import { queue, task } from "@trigger.dev/sdk";
import {
  type Messenger,
  SEND_INTERVAL_MS,
  sendMessengerMessage,
  sleep,
} from "../messenger";

export interface DeliverBroadcastPayload {
  broadcastId: string;
  /** initial — получатели в статусе pending; resend — досылка по ошибкам. */
  mode: "initial" | "resend";
}

// Одна рассылка за раз: даже если запустили рассылку и досылку одновременно,
// суммарный темп отправки не превысит SEND_INTERVAL_MS — лимиты не нарушаются.
const broadcastQueue = queue({
  name: "broadcast-deliver",
  concurrencyLimit: 1,
});

export const deliverBroadcast = task({
  id: "broadcast-deliver",
  queue: broadcastQueue,
  maxDuration: 3600,
  run: async (payload: DeliverBroadcastPayload) => {
    // Ленивый импорт: клиент БД подключается на верхнем уровне модуля
    // (top-level await + проверка POSTGRES_URL), поэтому статический импорт
    // ронял бы индексацию задач при деплое, где БД недоступна.
    const {
      finishBroadcast,
      getBroadcast,
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
        } catch (err) {
          await updateBroadcastRecipient(recipient.id, {
            status: "error",
            error: (err as Error).message,
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
