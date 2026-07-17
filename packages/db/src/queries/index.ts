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
  getBotTextsRecord as _getBotTextsRecord,
  saveBotTexts as _saveBotTexts,
} from "./bot-texts";

export * from "./ads";
export * from "./backup";
export * from "./broadcast";
export type { BotFunnelEvent, NewBotFunnelEvent } from "./bot-funnel";
export type { BotText } from "./bot-texts";

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
