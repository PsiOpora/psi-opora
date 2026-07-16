import { FUNNEL_STEPS, type FunnelStep } from "@psi-opora/bot-core";
import { getBotFunnelEventsByDateRange } from "@psi-opora/db/queries";
import type { DateRange } from "./types";

export interface BotFunnelEvent {
  day: string;
  messenger: string;
  step: FunnelStep;
  source: string;
  campaign: string;
  count: number;
}

export interface BotFunnelStepStats {
  step: FunnelStep;
  label: string;
  count: number;
  /** Доля от запустивших бота. */
  shareOfStart: number;
  /** Конверсия из предыдущего шага. */
  stepConversion: number;
}

export const STEP_LABELS: Record<FunnelStep, string> = {
  start: "Запустили бота (/start)",
  consult_click: "Нажали «Записаться»",
  consent: "Дали согласие на ПДн",
  name: "Оставили имя",
  phone: "Оставили телефон",
  deal: "Заявка создана в CRM",
};

export async function fetchBotFunnelEvents(
  range: DateRange,
): Promise<BotFunnelEvent[]> {
  const rows = await getBotFunnelEventsByDateRange(
    range.from.toISOString().slice(0, 10),
    range.to.toISOString().slice(0, 10),
  );

  return rows
    .filter((row) => (FUNNEL_STEPS as readonly string[]).includes(row.step))
    .map((row) => ({
      day: row.day,
      messenger: row.messenger,
      step: row.step as FunnelStep,
      source: row.source,
      campaign: row.campaign,
      count: row.count,
    }));
}

function stepTotals(events: BotFunnelEvent[]): Map<FunnelStep, number> {
  const totals = new Map<FunnelStep, number>();
  for (const event of events) {
    totals.set(event.step, (totals.get(event.step) ?? 0) + event.count);
  }
  return totals;
}

export function funnelStepStats(
  events: BotFunnelEvent[],
): BotFunnelStepStats[] {
  const totals = stepTotals(events);
  const start = totals.get("start") ?? 0;
  return FUNNEL_STEPS.map((step, i) => {
    const count = totals.get(step) ?? 0;
    const prev = i === 0 ? count : (totals.get(FUNNEL_STEPS[i - 1] ?? "start") ?? 0);
    return {
      step,
      label: STEP_LABELS[step],
      count,
      shareOfStart: start > 0 ? count / start : 0,
      stepConversion: i === 0 ? 1 : prev > 0 ? count / prev : 0,
    };
  });
}

export interface BotFunnelSourceRow {
  key: string;
  source: string;
  campaign: string;
  starts: number;
  clicks: number;
  phones: number;
  deals: number;
  /** Конверсия старт → заявка. */
  conversion: number;
}

export function funnelBySourceCampaign(
  events: BotFunnelEvent[],
): BotFunnelSourceRow[] {
  const rows = new Map<string, BotFunnelSourceRow>();
  for (const event of events) {
    const key = `${event.source}|${event.campaign}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        source: event.source,
        campaign: event.campaign,
        starts: 0,
        clicks: 0,
        phones: 0,
        deals: 0,
        conversion: 0,
      };
      rows.set(key, row);
    }
    if (event.step === "start") row.starts += event.count;
    if (event.step === "consult_click") row.clicks += event.count;
    if (event.step === "phone") row.phones += event.count;
    if (event.step === "deal") row.deals += event.count;
  }
  return [...rows.values()]
    .map((row) => ({
      ...row,
      conversion: row.starts > 0 ? row.deals / row.starts : 0,
    }))
    .sort((a, b) => b.starts - a.starts);
}

export function funnelByMessenger(
  events: BotFunnelEvent[],
): Array<{ messenger: string; steps: BotFunnelStepStats[] }> {
  const byMessenger = new Map<string, BotFunnelEvent[]>();
  for (const event of events) {
    const bucket = byMessenger.get(event.messenger);
    if (bucket) bucket.push(event);
    else byMessenger.set(event.messenger, [event]);
  }
  return [...byMessenger.entries()]
    .map(([messenger, group]) => ({ messenger, steps: funnelStepStats(group) }))
    .sort((a, b) => a.messenger.localeCompare(b.messenger));
}
