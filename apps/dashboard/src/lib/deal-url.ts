/** Ссылка на карточку сделки в Bitrix24 — безопасно для клиентских компонентов. */
export function dealUrl(domain: string, dealId: string): string {
  return `https://${domain}/crm/deal/details/${dealId}/`;
}
