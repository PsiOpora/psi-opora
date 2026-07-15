"use server";

import { revalidatePath } from "next/cache";
import {
  createBroadcast,
  finishBroadcast,
  insertBroadcastRecipients,
} from "@psi-opora/db/queries";
import { getBitrixApi } from "@/lib/bitrix/session";
import {
  type BroadcastChannel,
  type BroadcastReport,
  type Messenger,
  runBroadcast,
  sendMessengerMessage,
} from "@/lib/broadcast/send";

export interface BroadcastActionResult {
  report?: BroadcastReport;
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
}): Promise<BroadcastActionResult> {
  const api = await getBitrixApi();
  if (!api) return { error: "Bitrix24 не подключён" };

  if (!input.stageId) return { error: "Не выбрана стадия" };
  if (!input.dryRun && !input.message.trim()) {
    return { error: "Текст сообщения пуст" };
  }

  const message = input.message.trim();
  const broadcastId = crypto.randomUUID();

  if (!input.dryRun) {
    await createBroadcast({
      id: broadcastId,
      stageId: input.stageId,
      stageName: input.stageName,
      channel: input.channel,
      message,
    });
  }

  try {
    const report = await runBroadcast(api, {
      stageId: input.stageId,
      channel: input.channel,
      message,
      dryRun: input.dryRun,
    });

    if (!input.dryRun) {
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
    }

    return { report };
  } catch (err) {
    if (!input.dryRun) {
      await finishBroadcast(broadcastId, {
        status: "error",
        error: (err as Error).message,
      });
      revalidatePath("/broadcast");
    }
    return { error: (err as Error).message };
  }
}
