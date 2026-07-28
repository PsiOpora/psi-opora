import { SITE_CODES } from "./site-codes";

export interface UtmParams {
  source?: string;
  campaign?: string;
}

export function parseUtmParams(startParam: string | undefined): UtmParams {
  if (!startParam) return {};
  let decodedParam = startParam;
  try {
    decodedParam = decodeURIComponent(startParam);
  } catch {
    // Некорректный percent-encoding не должен ломать запуск бота:
    // сохраняем исходную метку как раньше.
  }

  const entry = SITE_CODES[decodedParam];
  if (entry) return { source: entry.source, campaign: entry.campaign };
  // код не зарегистрирован в SITE_CODES — не теряем трафик,
  // трактуем как кампанию по старой схеме, но без источника
  return { campaign: decodedParam };
}

export function buildStartLink(botUsername: string, code: string): string {
  return `https://t.me/${botUsername}?start=${code}`;
}

export function formatUtmLog(params: UtmParams): string {
  const parts = [
    params.source && `source=${params.source}`,
    params.campaign && `campaign=${params.campaign}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : "без метки";
}
