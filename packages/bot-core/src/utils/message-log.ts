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
    });
  } catch (err) {
    console.error(
      `[messages] не удалось записать сообщение в журнал: ${(err as Error).message}`,
    );
  }
}
