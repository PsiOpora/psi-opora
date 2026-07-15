/**
 * Node.js запросы к БД (использует node-postgres или neon-http в зависимости от env).
 * Для Edge Runtime используйте @psi-opora/db/queries.edge
 */
import { db } from "../client";
import {
  getBotFunnelEventsByDateRange as _getBotFunnelEventsByDateRange,
  upsertBotFunnelEvent as _upsertBotFunnelEvent,
} from "./bot-funnel";

export * from "./ads";
export * from "./backup";
export type { BotFunnelEvent, NewBotFunnelEvent } from "./bot-funnel";

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
