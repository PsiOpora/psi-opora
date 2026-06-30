export interface UtmParams {
  campaign?: string;
}

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
