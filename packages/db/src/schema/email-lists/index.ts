import { sql } from "drizzle-orm";
import {
	check,
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Собственные списки контактов — аудитория рассылок, не привязанная к CRM:
 * наполняются импортом CSV или вручную на странице /email-lists. Исторически
 * только email (отсюда имя таблицы), теперь у контакта может быть и телефон —
 * по нему идёт мультиканальная рассылка через личные номера (outreach_*).
 */
export const emailLists = pgTable("email_lists", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	description: text("description"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const emailListContacts = pgTable(
	"email_list_contacts",
	{
		id: text("id").primaryKey(),
		listId: text("list_id")
			.notNull()
			.references(() => emailLists.id, { onDelete: "cascade" }),
		/** Нормализованный (trim + lower case) адрес — по нему уникальность в списке. */
		email: text("email"),
		/** Нормализованный телефон `+79991234567` — тоже уникален в списке. */
		phone: text("phone"),
		name: text("name"),
		source: text("source").notNull(), // csv | manual
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		// NULL в уникальном индексе Postgres не считается дублем — контакты
		// только с телефоном (или только с email) не конфликтуют между собой.
		uniqueIndex("email_list_contacts_list_email_idx").on(
			table.listId,
			table.email,
		),
		uniqueIndex("email_list_contacts_list_phone_idx").on(
			table.listId,
			table.phone,
		),
		index("email_list_contacts_list_created_idx").on(
			table.listId,
			table.createdAt,
		),
		check(
			"email_list_contacts_email_or_phone",
			sql`${table.email} is not null or ${table.phone} is not null`,
		),
	],
);
