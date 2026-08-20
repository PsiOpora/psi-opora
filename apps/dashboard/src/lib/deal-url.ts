/** Ссылка на карточку сделки в Bitrix24 — безопасно для клиентских компонентов. */
export function dealUrl(domain: string, dealId: string): string {
  return `https://${domain}/crm/deal/details/${dealId}/`;
}

/**
 * Ссылка на список сделок в Bitrix24, отфильтрованный по воронке и/или
 * стадии — для перехода из отчётов дашборда в CRM.
 */
export function dealListUrl(
  domain: string,
  filter: { categoryId?: string; stageId?: string },
): string {
  const params = new URLSearchParams({ apply_filter: "Y" });
  if (filter.categoryId) params.set("filter[CATEGORY_ID]", filter.categoryId);
  if (filter.stageId) params.set("filter[STAGE_ID]", filter.stageId);
  return `https://${domain}/crm/deal/list/?${params.toString()}`;
}
