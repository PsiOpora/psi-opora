export interface UtmParams {
  campaign?: string; // значение из start-параметра ссылки
}

// Telegram start param: A-Za-z0-9_- (max 64 chars)
// Передаём простую метку кампании — откуда пришёл клиент.
// Пример: https://t.me/bot?start=google_cpc
//         https://t.me/bot?start=yandex_search
//         https://t.me/bot?start=vk_promo

export function parseUtmParams(startParam: string | undefined): UtmParams {
  if (!startParam) return {};
  return { campaign: startParam };
}

export function buildStartLink(botUsername: string, campaign: string): string {
  return `https://t.me/${botUsername}?start=${campaign}`;
}

export function formatUtmLog(params: UtmParams): string {
  return params.campaign ? `campaign=${params.campaign}` : "без метки";
}
