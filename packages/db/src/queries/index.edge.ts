/**
 * Edge-совместимые запросы к БД.
 * Использует neon-http драйвер — не содержит node:module зависимостей.
 */
import { db } from "../client.edge";
import {
  upsertBotFunnelEvent as _upsertBotFunnelEvent,
  getBotFunnelEventsByDateRange as _getBotFunnelEventsByDateRange,
} from "./bot-funnel";

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
