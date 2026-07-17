"use server";

import {
  createBroadcast,
  finishBroadcast,
  getBroadcast,
  getLastBroadcastForStage,
  insertBroadcastRecipients,
  listBroadcastRecipients,
  markBroadcastRunning,
} from "@psi-opora/db/queries";
import type { deliverBroadcast } from "@psi-opora/jobs";
import { sendMessengerMessage } from "@psi-opora/jobs";
import { tasks } from "@trigger.dev/sdk";
import { revalidatePath } from "next/cache";
import { MESSAGE_MAX_LENGTH } from "@/lib/broadcast/constants";
import { getBitrixApi } from "@/lib/bitrix/session";
import {
  type BroadcastChannel,
  type BroadcastReport,
  type Messenger,
  buildReport,
  collectRecipients,
} from "@/lib/broadcast/send";

export interface RecentBroadcastInfo {
  startedAt: Date | null;
  sentCount: number;
}

export interface BroadcastActionResult {
  report?: BroadcastReport;
  /** Последняя рассылка по этой же стадии — предупреждение о возможном дубле. */
  recentBroadcast?: RecentBroadcastInfo | null;
  /** ID рассылки, поставленной в очередь trigger.dev. */
  queuedBroadcastId?: string;
  /** Сколько получателей будет отправлено фоновой задачей. */
  queuedCount?: number;
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
  if (!input.userId)
    return { ok: false, error: "У контакта нет ID мессенджера" };

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

    const pendingCount = recipients.filter(
      (r) => r.status === "pending",
    ).length;
    if (pendingCount === 0) {
      return { error: "Среди получателей некому отправлять" };
    }

    const broadcastId = crypto.randomUUID();
    await createBroadcast({
      id: broadcastId,
      stageId: input.stageId,
      stageName: input.stageName,
      channel: input.channel,
      message,
      totalDeals,
    });
    await insertBroadcastRecipients(
      recipients.map((r) => ({
        id: crypto.randomUUID(),
        broadcastId,
        contactId: r.contactId,
        contactName: r.contactName,
        dealId: r.dealId,
        dealTitle: r.dealTitle,
        messenger: r.messenger,
        messengerUserId: r.userId,
        status: r.status,
        error: r.error,
        sentAt: null,
      })),
    );

    try {
      await tasks.trigger<typeof deliverBroadcast>("broadcast-deliver", {
        broadcastId,
        mode: "initial",
      });
    } catch (err) {
      await finishBroadcast(broadcastId, {
        status: "error",
        error: `Не удалось запустить фоновую задачу: ${(err as Error).message}`,
      });
      revalidatePath("/broadcast");
      return {
        error: `Рассылка не запущена: ${(err as Error).message}. Проверьте настройку trigger.dev (TRIGGER_SECRET_KEY).`,
      };
    }

    revalidatePath("/broadcast");
    return { queuedBroadcastId: broadcastId, queuedCount: pendingCount };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export interface ResendResult {
  /** Сколько получателей поставлено в очередь на досылку. */
  queued: number;
  error?: string;
}

/**
 * Досылка сообщения получателям рассылки, у которых была ошибка отправки:
 * ставит фоновую задачу trigger.dev. Успешные и пропущенные не трогаются.
 */
export async function resendFailedAction(
  broadcastId: string,
): Promise<ResendResult> {
  const broadcast = await getBroadcast(broadcastId);
  if (!broadcast) return { queued: 0, error: "Рассылка не найдена" };
  if (broadcast.status === "running") {
    return {
      queued: 0,
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
    return { queued: 0, error: "Нет получателей с ошибкой" };
  }

  await markBroadcastRunning(broadcastId);
  try {
    await tasks.trigger<typeof deliverBroadcast>("broadcast-deliver", {
      broadcastId,
      mode: "resend",
    });
  } catch (err) {
    await finishBroadcast(broadcastId, {
      status: "error",
      error: `Не удалось запустить досылку: ${(err as Error).message}`,
    });
    return { queued: 0, error: (err as Error).message };
  }

  revalidatePath("/broadcast");
  revalidatePath(`/broadcast/${broadcastId}`);
  return { queued: failed.length };
}
