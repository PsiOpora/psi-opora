import { Redis } from "@upstash/redis";

/**
 * Шаги воронки бота в порядке прохождения. Email не трекается отдельно —
 * он есть только в Telegram-сценарии и необязателен, воронки мессенджеров
 * должны быть сравнимы между собой.
 */
export const FUNNEL_STEPS = ["start", "consult_click", "consent", "name", "phone", "deal"] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export interface FunnelEventContext {
  messenger: string;
  source?: string;
  campaign?: string;
}

const FIELD_SEP = "|";
const KEY_PREFIX = "botfunnel:";
const TTL_SECONDS = 400 * 24 * 60 * 60;

let redis: Redis | null | undefined;

function getRedis(): Redis | null {
  if (redis === undefined) {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;
    redis = url && token ? new Redis({ url, token }) : null;
  }
  return redis;
}

function sanitize(value: string | undefined): string {
  const clean = (value ?? "").replaceAll(FIELD_SEP, "_").trim();
  return clean || "-";
}

export function funnelDayKey(day: string): string {
  return `${KEY_PREFIX}${day}`;
}

/** Поле хеша: messenger|step|source|campaign — парсится parseFunnelField. */
export function parseFunnelField(field: string): { messenger: string; step: string; source: string; campaign: string } | null {
  const [messenger, step, source, campaign] = field.split(FIELD_SEP);
  if (!messenger || !step || source === undefined || campaign === undefined) return null;
  return { messenger, step, source, campaign };
}

/**
 * Инкремент счётчика шага воронки за сегодня. Ошибки Redis не должны
 * ломать диалог с клиентом — логируются и глотаются.
 */
export async function trackFunnelStep(step: FunnelStep, ctx: FunnelEventContext): Promise<void> {
  const client = getRedis();
  if (!client) return;

  const day = new Date().toISOString().slice(0, 10);
  const field = [ctx.messenger, step, sanitize(ctx.source), sanitize(ctx.campaign)].join(FIELD_SEP);
  try {
    const key = funnelDayKey(day);
    await client.hincrby(key, field, 1);
    await client.expire(key, TTL_SECONDS);
  } catch (err) {
    console.error(`[funnel] не удалось записать событие ${step}: ${(err as Error).message}`);
  }
}
