import { asc, eq } from "drizzle-orm";
import { db } from "../client";
import { emailTemplates } from "../schema/email-templates";

export type EmailTemplate = typeof emailTemplates.$inferSelect;

export async function listEmailTemplates(): Promise<EmailTemplate[]> {
  if (!db) return [];
  return db.select().from(emailTemplates).orderBy(asc(emailTemplates.title));
}

export async function getEmailTemplate(
  id: string,
): Promise<EmailTemplate | null> {
  if (!db) return null;
  const rows = await db
    .select()
    .from(emailTemplates)
    .where(eq(emailTemplates.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** Создаёт или обновляет шаблон (id не передан — создаём новый). */
export async function saveEmailTemplate(entry: {
  id?: string;
  title: string;
  subject: string;
  templateKey: string;
  fields: Record<string, string>;
}): Promise<EmailTemplate | null> {
  if (!db) return null;
  const now = new Date();
  const [row] = await db
    .insert(emailTemplates)
    .values({
      id: entry.id ?? crypto.randomUUID(),
      title: entry.title,
      subject: entry.subject,
      templateKey: entry.templateKey,
      fields: entry.fields,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: emailTemplates.id,
      set: {
        title: entry.title,
        subject: entry.subject,
        templateKey: entry.templateKey,
        fields: entry.fields,
        updatedAt: now,
      },
    })
    .returning();
  return row ?? null;
}

export async function deleteEmailTemplate(id: string): Promise<void> {
  if (!db) return;
  await db.delete(emailTemplates).where(eq(emailTemplates.id, id));
}

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
