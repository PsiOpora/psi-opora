import { SITE_CODES } from "./site-codes";

export interface UtmParams {
  source?: string;
  campaign?: string;
}

/**
 * Мессенджер отдаёт start-параметр в том виде, в каком он стоял в ссылке —
 * то есть percent-encoded, если метка или кодовое слово не латиницей.
 * Декодируем до любых сравнений: иначе `%D0%A8%D0%9A%D0%9E%D0%9B%D0%90` не
 * совпадёт с кодовым словом «ШКОЛА» в bot_guide_campaigns и переход по
 * ссылке молча уедет в обычный сценарий.
 */
export function decodeStartParam(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    // Некорректный percent-encoding не должен ломать запуск бота:
    // сохраняем исходную метку как раньше.
    return raw;
  }
}

export function parseUtmParams(startParam: string | undefined): UtmParams {
  if (!startParam) return {};
  const decodedParam = decodeStartParam(startParam) ?? startParam;

  const entry = SITE_CODES[decodedParam];
  if (entry) return { source: entry.source, campaign: entry.campaign };
  // код не зарегистрирован в SITE_CODES — не теряем трафик,
  // трактуем как кампанию по старой схеме, но без источника
  return { campaign: decodedParam };
}

/**
 * Telegram допускает в start-параметре только латиницу, цифры, `_` и `-`
 * (до 64 символов) — кириллическое кодовое слово в ссылке не работает,
 * хотя тем же словом бот отвечает, если написать его текстом в чат.
 * Дашборд опирается на это, чтобы не показывать заказчику битую ссылку.
 */
const START_PARAM_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidStartParam(code: string): boolean {
  return START_PARAM_RE.test(code);
}

/**
 * Кодовое слово кампании гайда — та же латиница/цифры/`-`, что и в
 * isValidStartParam, но без `_`: подчёркивание зарезервировано под источник
 * рекламы в ссылке (см. splitStartParam) и однозначно отделяет слово от
 * метки, только если само слово его не содержит.
 */
const CAMPAIGN_KEYWORD_RE = /^[A-Za-z0-9-]{1,64}$/;

export function isValidCampaignKeyword(keyword: string): boolean {
  return CAMPAIGN_KEYWORD_RE.test(keyword);
}

/**
 * Ссылка «кодовое слово + источник рекламы» вида `SCHOOL_VK`,
 * `SCHOOL_INSTAGRAM` — чтобы отличать, из какой рекламы пришёл клиент,
 * не заводя для каждого источника отдельную кампанию. Делим по первому `_`:
 * при соблюдении isValidCampaignKeyword (слово без `_`) это однозначно.
 * source не валидируется списком — рекламных площадок слишком много и
 * список быстро устареет, поэтому источник — любая строка в рамках
 * isValidStartParam, которую задаёт администратор в дашборде.
 */
export function splitStartParam(raw: string): {
  keyword: string;
  source?: string;
} {
  const index = raw.indexOf("_");
  if (index === -1) return { keyword: raw };
  const keyword = raw.slice(0, index);
  const source = raw.slice(index + 1);
  if (!keyword || !source) return { keyword: raw };
  return { keyword, source };
}

export function buildStartLink(botUsername: string, code: string): string {
  return `https://t.me/${stripAt(botUsername)}?start=${code}`;
}

/**
 * Диплинк для MAX. Формат ссылки повторяет телеграмный (`?start=`), и бот
 * получает значение в `startPayload` события bot_started — см.
 * handleStart в apps/max-bot/src/bot.ts.
 */
export function buildMaxStartLink(botUsername: string, code: string): string {
  return `https://max.ru/${stripAt(botUsername)}?start=${code}`;
}

/** Заказчик почти всегда вводит username с «@» — принимаем оба варианта. */
function stripAt(botUsername: string): string {
  return botUsername.trim().replace(/^@/, "");
}

export function formatUtmLog(params: UtmParams): string {
  const parts = [
    params.source && `source=${params.source}`,
    params.campaign && `campaign=${params.campaign}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : "без метки";
}
