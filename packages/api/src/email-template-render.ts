/** Плейсхолдеры, доступные в HTML собственных email-шаблонов. */
export const EMAIL_TEMPLATE_PLACEHOLDERS = ["name", "email"] as const;
export type EmailTemplatePlaceholder = (typeof EMAIL_TEMPLATE_PLACEHOLDERS)[number];

/** Подставляет {{name}}/{{email}} значениями получателя — для превью и поштучной отправки (Rusender, sendTest). */
export function renderEmailTemplate(
  html: string,
  values: { name?: string | null; email?: string | null },
): string {
  return html
    .replaceAll("{{name}}", values.name ?? "")
    .replaceAll("{{email}}", values.email ?? "");
}

/**
 * Заменяет {{name}}/{{email}} на теги подстановки Unisender (%Name%/%email%),
 * совпадающие с field_names у importContacts — для массовой рассылки по
 * списку, где подстановку на каждого получателя делает сам Unisender.
 */
export function toUnisenderTags(html: string): string {
  return html
    .replaceAll("{{name}}", "%Name%")
    .replaceAll("{{email}}", "%email%");
}
