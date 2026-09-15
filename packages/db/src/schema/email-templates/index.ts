import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Собственные email-шаблоны — заменяют шаблоны из личного кабинета Unisender.
 * Тело письма не хранится как HTML: templateKey указывает на готовый React Email
 * компонент (packages/emails/campaign-templates), fields — значения его полей.
 */
export const emailTemplates = pgTable("email_templates", {
	id: text("id").primaryKey(),
	title: text("title").notNull(),
	subject: text("subject").notNull(),
	templateKey: text("template_key").notNull(),
	fields: jsonb("fields").$type<Record<string, string>>().notNull().default({}),
	createdAt: timestamp("created_at").defaultNow(),
	updatedAt: timestamp("updated_at").defaultNow(),
});
