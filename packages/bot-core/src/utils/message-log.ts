import { insertBotMessage } from "@psi-opora/db/queries.edge";

export type BotMessageDirection = "in" | "out";
export type BotMessageSource = "scenario" | "reminder" | "widget" | "broadcast";

export interface BotMessageLogEntry {
  messenger: string;
  /** ID клиента в мессенджере (chat id TG / user id MAX). */
  userId: string | number | undefined;
  direction: BotMessageDirection;
  source: BotMessageSource;
  text: string;
  /** По умолчанию "text". "voice" — заливаем mediaS3Key голосового вложения. */
  kind?: "text" | "voice";
  mediaS3Key?: string;
  mediaMimeType?: string;
  mediaDurationSec?: number;
}

/**
 * Пишет сообщение в журнал bot_messages. Ошибки записи не должны
 * ломать диалог с клиентом — логируются и глотаются.
 */
export async function logBotMessage(entry: BotMessageLogEntry): Promise<void> {
  if (entry.userId === undefined || entry.userId === null) return;
  const text = entry.text.trim();
  if (!text) return;

  try {
    await insertBotMessage({
      messenger: entry.messenger,
      userId: String(entry.userId),
      direction: entry.direction,
      source: entry.source,
      text,
      kind: entry.kind,
      mediaS3Key: entry.mediaS3Key,
      mediaMimeType: entry.mediaMimeType,
      mediaDurationSec: entry.mediaDurationSec,
    });
  } catch (err) {
    const error = err as Error;
    console.error(
      `[messages] не удалось записать сообщение в журнал: ${error.message}`,
      error.cause ?? "",
      error.stack ?? "",
    );
  }
}
