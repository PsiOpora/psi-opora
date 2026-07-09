import { env } from "@psi-opora/config";
import { upsertBotFunnelEvent as upsertEdge } from "@psi-opora/db/queries.edge";
import { Redis } from "@upstash/redis";

/**
 * Тип функции upsert для событий воронки.
 * Позволяет подменять реализацию (edge vs node) через setFunnelUpsert.
 */
export type UpsertFunnelFn = (data: {
  day: string;
  messenger: string;
  step: string;
  source?: string;
  campaign?: string;
}) => Promise<void>;

/**
 * По умолчанию используется edge-версия (neon-http) — подходит для TG webhook.
 * MAX-бот (Node.js runtime) вызывает setFunnelUpsert с node-версией при старте.
 */
let _upsertFn: UpsertFunnelFn = upsertEdge;

/**
 * Устанавливает функцию upsert для событий воронки.
 * Вызывайте один раз при инициализации бота в Node.js окружении:
 *
 */
export function setFunnelUpsert(fn: UpsertFunnelFn): void {
  _upsertFn = fn;
}

/**
 * Шаги воронки бота в порядке прохождения. Email не трекается отдельно —
 * он есть только в Telegram-сценарии и необязателен, воронки мессенджеров
 * должны быть сравнимы между собой.
 */
export const FUNNEL_STEPS = [
  "start",
  "consult_click",
  "consent",
  "name",
  "phone",
  "deal",
] as const;
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
    const url = env.KV_REST_API_URL;
    const token = env.KV_REST_API_TOKEN;
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
export function parseFunnelField(field: string): {
  messenger: string;
  step: string;
  source: string;
  campaign: string;
} | null {
  const [messenger, step, source, campaign] = field.split(FIELD_SEP);
  if (!messenger || !step || source === undefined || campaign === undefined)
    return null;
  return { messenger, step, source, campaign };
}

/**
 * Инкремент счётчика шага воронки за сегодня. Ошибки не должны
 * ломать диалог с клиентом — логируются и глотаются.
 * Записывает в PostgreSQL как основное хранилище, и в Redis как резерв.
 */
export async function trackFunnelStep(
  step: FunnelStep,
  ctx: FunnelEventContext,
): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const source = sanitize(ctx.source);
  const campaign = sanitize(ctx.campaign);

  // 1. Записываем в PostgreSQL (основное хранилище)
  try {
    await _upsertFn({
      day,
      messenger: ctx.messenger,
      step,
      source,
      campaign,
    });
  } catch (err) {
    console.error(
      `[funnel] не удалось записать событие ${step} в Postgres: ${(err as Error).message}`,
    );
  }

  // 2. Записываем в Redis (резерв, для обратной совместимости)
  const client = getRedis();
  if (client) {
    const field = [ctx.messenger, step, source, campaign].join(FIELD_SEP);
    try {
      const key = funnelDayKey(day);
      await client.hincrby(key, field, 1);
      await client.expire(key, TTL_SECONDS);
    } catch (err) {
      console.error(
        `[funnel] не удалось записать событие ${step} в Redis: ${(err as Error).message}`,
      );
    }
  }
}
