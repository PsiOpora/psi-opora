"use server";

import { getBitrixApi } from "@/lib/bitrix/session";
import {
  type BroadcastChannel,
  type BroadcastReport,
  runBroadcast,
} from "@/lib/broadcast/send";

export interface BroadcastActionResult {
  report?: BroadcastReport;
  error?: string;
}

export async function sendBroadcastAction(input: {
  stageId: string;
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

  try {
    const report = await runBroadcast(api, {
      stageId: input.stageId,
      channel: input.channel,
      message: input.message.trim(),
      dryRun: input.dryRun,
    });
    return { report };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
