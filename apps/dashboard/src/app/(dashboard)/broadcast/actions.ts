"use server";

import {
  createBroadcast,
  finishBroadcast,
  getBroadcast,
  getLastBroadcastForStage,
  insertBroadcastRecipients,
  listBroadcastRecipients,
  updateBroadcastCounters,
  updateBroadcastRecipient,
} from "@psi-opora/db/queries";
import { revalidatePath } from "next/cache";
import { MESSAGE_MAX_LENGTH } from "@/lib/broadcast/constants";
import { getBitrixApi } from "@/lib/bitrix/session";
import {
  type BroadcastChannel,
  type BroadcastReport,
  type Messenger,
  buildReport,
  collectRecipients,
  deliverToRecipients,
  sendDelay,
  sendMessengerMessage,
} from "@/lib/broadcast/send";

export interface RecentBroadcastInfo {
  startedAt: Date | null;
  sentCount: number;
}

export interface BroadcastActionResult {
  report?: BroadcastReport;
  /** Последняя рассылка по этой же стадии — предупреждение о возможном дубле. */
  recentBroadcast?: RecentBroadcastInfo | null;
  error?: string;
}

/** Тестовая отправка текущего текста одному получателю из предпросмотра. */
export async function sendTestMessageAction(input: {
  messenger: Messenger;
  userId: string;
  message: string;
}): Promise<{ ok: boolean; error?: string }> {
  const message = input.message.trim();
  if (!message) return { ok: false, error: "Текст сообщения пуст" };
  if (message.length > MESSAGE_MAX_LENGTH) {
    return {
      ok: false,
      error: `Сообщение длиннее ${MESSAGE_MAX_LENGTH} символов`,
    };
  }
  if (!input.userId) return { ok: false, error: "У контакта нет ID мессенджера" };

  try {
    await sendMessengerMessage(input.messenger, input.userId, message);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function sendBroadcastAction(input: {
  stageId: string;
  stageName?: string;
  channel: BroadcastChannel;
  message: string;
  dryRun: boolean;
  /**
   * Число получателей из предпросмотра. Для реальной отправки обязательно:
   * если состав изменился с момента предпросмотра — рассылка не запускается.
   */
  expectedRecipients?: number;
}): Promise<BroadcastActionResult> {
  const api = await getBitrixApi();
  if (!api) return { error: "Bitrix24 не подключён" };

  if (!input.stageId) return { error: "Не выбрана стадия" };

  const message = input.message.trim();
  if (!input.dryRun && !message) return { error: "Текст сообщения пуст" };
  if (message.length > MESSAGE_MAX_LENGTH) {
    return {
      error: `Сообщение длиннее ${MESSAGE_MAX_LENGTH} символов — Telegram и MAX его не примут`,
    };
  }
  if (!input.dryRun && input.expectedRecipients === undefined) {
    return {
      error:
        "Отправка без предпросмотра запрещена — сначала нажмите «Показать получателей»",
    };
  }

  try {
    const { totalDeals, recipients } = await collectRecipients(
      api,
      input.stageId,
      input.channel,
    );

    if (input.dryRun) {
      const recent = await getLastBroadcastForStage(input.stageId).catch(
        () => null,
      );
      return {
        report: buildReport(totalDeals, recipients, true),
        recentBroadcast: recent
          ? { startedAt: recent.startedAt, sentCount: recent.sentCount }
          : null,
      };
    }

    if (input.expectedRecipients !== recipients.length) {
      return {
        error: `Состав получателей изменился с момента предпросмотра (было ${input.expectedRecipients}, стало ${recipients.length}). Обновите предпросмотр и проверьте список ещё раз.`,
      };
    }

    const broadcastId = crypto.randomUUID();
    await createBroadcast({
      id: broadcastId,
      stageId: input.stageId,
      stageName: input.stageName,
      channel: input.channel,
      message,
    });

    try {
      await deliverToRecipients(recipients, message);
      const report = buildReport(totalDeals, recipients, false);

      await insertBroadcastRecipients(
        report.recipients.map((r) => ({
          id: crypto.randomUUID(),
          broadcastId,
          contactId: r.contactId,
          contactName: r.contactName,
          dealId: r.dealId,
          dealTitle: r.dealTitle,
          messenger: r.messenger,
          messengerUserId: r.userId,
          status: r.status === "pending" ? "skipped" : r.status,
          error: r.error,
          sentAt: r.status === "sent" ? new Date() : null,
        })),
      );
      await finishBroadcast(broadcastId, {
        status: "done",
        totalDeals: report.totalDeals,
        sentCount: report.sent,
        skippedCount: report.skipped,
        failedCount: report.failed,
      });
      revalidatePath("/broadcast");

      return { report };
    } catch (err) {
      await finishBroadcast(broadcastId, {
        status: "error",
        error: (err as Error).message,
      });
      revalidatePath("/broadcast");
      throw err;
    }
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export interface ResendResult {
  resent: number;
  stillFailed: number;
  error?: string;
}

/**
 * Досылка сообщения получателям рассылки, у которых была ошибка отправки.
 * Использует сохранённый текст рассылки; успешные и пропущенные не трогаются.
 */
export async function resendFailedAction(
  broadcastId: string,
): Promise<ResendResult> {
  const broadcast = await getBroadcast(broadcastId);
  if (!broadcast) {
    return { resent: 0, stillFailed: 0, error: "Рассылка не найдена" };
  }
  if (broadcast.status === "running") {
    return {
      resent: 0,
      stillFailed: 0,
      error: "Рассылка ещё выполняется — дождитесь завершения",
    };
  }

  const failed = (await listBroadcastRecipients(broadcastId)).filter(
    (r) =>
      r.status === "error" &&
      (r.messenger === "telegram" || r.messenger === "max") &&
      r.messengerUserId,
  );
  if (failed.length === 0) {
    return { resent: 0, stillFailed: 0, error: "Нет получателей с ошибкой" };
  }

  let resent = 0;
  for (const recipient of failed) {
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
      resent++;
    } catch (err) {
      await updateBroadcastRecipient(recipient.id, {
        status: "error",
        error: (err as Error).message,
        sentAt: null,
      });
    }
    await sendDelay();
  }

  await updateBroadcastCounters(broadcastId, {
    sentCount: broadcast.sentCount + resent,
    failedCount: broadcast.failedCount - resent,
  });
  revalidatePath("/broadcast");
  revalidatePath(`/broadcast/${broadcastId}`);

  return { resent, stillFailed: failed.length - resent };
}
