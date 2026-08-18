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
