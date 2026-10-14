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

/**
 * Плейсхолдеры, доступные в HTML собственных email-шаблонов.
 * unsubscribe_url вставляется футером шаблона (ссылка «Отписаться»), а не
 * пользователем.
 */
export const EMAIL_TEMPLATE_PLACEHOLDERS = [
	"name",
	"email",
	"unsubscribe_url",
] as const;
export type EmailTemplatePlaceholder =
	(typeof EMAIL_TEMPLATE_PLACEHOLDERS)[number];

/** Экранирует значение для вставки в HTML (текст и атрибуты). */
function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

/**
 * Подставляет плейсхолдеры значениями получателя — для превью и поштучной
 * отправки (Rusender, sendTest). Значения экранируются: имя из CSV или CRM —
 * недоверенные данные и не должны ломать вёрстку письма. Без ссылки отписки
 * (превью, тест) подставляется "#".
 */
export function renderEmailTemplate(
	html: string,
	values: {
		name?: string | null;
		email?: string | null;
		unsubscribeUrl?: string | null;
	},
): string {
	return html
		.replaceAll("{{name}}", escapeHtml(values.name ?? ""))
		.replaceAll("{{email}}", escapeHtml(values.email ?? ""))
		.replaceAll(
			"{{unsubscribe_url}}",
			escapeHtml(values.unsubscribeUrl || "#"),
		);
}

/**
 * Заменяет плейсхолдеры на теги подстановки Unisender ({{Name}}/{{Email}} —
 * Name совпадает с field_names у importContacts; {{UnsubscribeUrl}} —
 * персональная ссылка отписки Unisender) — для массовой рассылки по списку,
 * где подстановку на каждого получателя делает сам Unisender.
 */
export function toUnisenderTags(html: string): string {
	return html
		.replaceAll("{{name}}", "{{Name}}")
		.replaceAll("{{email}}", "{{Email}}")
		.replaceAll("{{unsubscribe_url}}", "{{UnsubscribeUrl}}");
}
