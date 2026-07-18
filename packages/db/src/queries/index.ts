/**
 * Node.js запросы к БД (использует node-postgres или neon-http в зависимости от env).
 * Для Edge Runtime используйте @psi-opora/db/queries.edge
 */
import { db } from "../client";
import {
  getBotFunnelEventsByDateRange as _getBotFunnelEventsByDateRange,
  upsertBotFunnelEvent as _upsertBotFunnelEvent,
} from "./bot-funnel";
import {
  type BotMessageEntry,
  insertBotMessage as _insertBotMessage,
  listBotMessages as _listBotMessages,
  listBotMessagesSince as _listBotMessagesSince,
} from "./bot-messages";
import {
  getBotTextsRecord as _getBotTextsRecord,
  saveBotTexts as _saveBotTexts,
} from "./bot-texts";

export * from "./ads";
export * from "./backup";
export * from "./broadcast";
export type { BotFunnelEvent, NewBotFunnelEvent } from "./bot-funnel";
export type { BotMessage, BotMessageEntry, NewBotMessage } from "./bot-messages";
export type { BotText } from "./bot-texts";

export async function insertBotMessage(entry: BotMessageEntry): Promise<void> {
  return _insertBotMessage(db, entry);
}

export async function listBotMessages(
  messenger: string,
  userId: string,
  limit?: number,
) {
  return _listBotMessages(db, messenger, userId, limit);
}

export async function listBotMessagesSince(
  messenger: string,
  userId: string,
  since: Date,
  limit?: number,
) {
  return _listBotMessagesSince(db, messenger, userId, since, limit);
}

export async function getBotTextsRecord(): Promise<Record<string, string>> {
  return _getBotTextsRecord(db);
}

export async function saveBotTexts(
  entries: Record<string, string>,
): Promise<void> {
  return _saveBotTexts(db, entries);
}

export async function upsertBotFunnelEvent(
  data: Parameters<typeof _upsertBotFunnelEvent>[1],
): Promise<void> {
  return _upsertBotFunnelEvent(db, data);
}

export async function getBotFunnelEventsByDateRange(
  fromDate: string,
  toDate: string,
) {
  return _getBotFunnelEventsByDateRange(db, fromDate, toDate);
}
