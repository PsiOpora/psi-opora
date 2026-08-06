import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Собственные HTML-шаблоны email-рассылок — заменяют шаблоны из личного кабинета Unisender. */
export const emailTemplates = pgTable("email_templates", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  subject: text("subject").notNull(),
  htmlBody: text("html_body").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
