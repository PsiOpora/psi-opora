import { z } from "zod";

/**
 * Схема валидации для доменного имени Bitrix24 портала.
 * Принимает только hostname (без протокола, пути, query, фрагмента).
 */
const DealDomainSchema = z
  .string()
  .min(1)
  .refine(
    (value) => {
      try {
        // Парсим с явным протоколом для проверки формата hostname
        const url = new URL(value.includes("://") ? value : `https://${value}`);
        // Отклоняем всё кроме чистого hostname
        return (
          url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          !url.port &&
          url.pathname === "/" &&
          !url.search &&
          !url.hash
        );
      } catch {
        return false;
      }
    },
    { message: "Некорректный домен портала Bitrix24" }
  );

/**
 * Нормализует и валидирует домен портала Bitrix24, приводя к hostname
 * в нижнем регистре. Отклоняет пути, query-параметры, фрагменты.
 */
function validateAndNormalizeDomain(domain: string): string {
  const validated = DealDomainSchema.parse(domain);
  const url = new URL(validated.includes("://") ? validated : `https://${validated}`);
  return url.hostname.toLowerCase();
}

/** Ссылка на карточку сделки в Bitrix24 — безопасно для клиентских компонентов. */
export function dealUrl(domain: string, dealId: string): string {
  const normalized = validateAndNormalizeDomain(domain);
  return `https://${normalized}/crm/deal/details/${dealId}/`;
}

/**
 * Ссылка на список сделок в Bitrix24, отфильтрованный по воронке и/или
 * стадии — для перехода из отчётов дашборда в CRM.
 */
export function dealListUrl(
  domain: string,
  filter: { categoryId?: string; stageId?: string; dateFrom?: string; dateTo?: string },
): string {
  const normalized = validateAndNormalizeDomain(domain);
  const params = new URLSearchParams({ apply_filter: "Y" });
  if (filter.categoryId) params.set("filter[CATEGORY_ID]", filter.categoryId);
  if (filter.stageId) params.set("filter[STAGE_ID]", filter.stageId);
  if (filter.dateFrom) params.set("filter[>=DATE_CREATE]", filter.dateFrom);
  if (filter.dateTo) params.set("filter[<=DATE_CREATE]", filter.dateTo);
  return `https://${normalized}/crm/deal/list/?${params.toString()}`;
}
