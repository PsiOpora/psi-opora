/**
 * Edge-совместимые запросы к БД.
 * Использует neon-http драйвер — не содержит node:module зависимостей.
 */
import { db } from "../client.edge";
import {
  getBotFunnelEventsByDateRange as _getBotFunnelEventsByDateRange,
  upsertBotFunnelEvent as _upsertBotFunnelEvent,
} from "./bot-funnel";
import {
  type BotMessageEntry,
  insertBotMessage as _insertBotMessage,
} from "./bot-messages";
import { getBotTextsRecord as _getBotTextsRecord } from "./bot-texts";

export type { BotFunnelEvent, NewBotFunnelEvent } from "./bot-funnel";
export type { BotMessageEntry } from "./bot-messages";

export async function insertBotMessage(entry: BotMessageEntry): Promise<void> {
  return _insertBotMessage(db, entry);
}

export async function getBotTextsRecord(): Promise<Record<string, string>> {
  return _getBotTextsRecord(db);
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
