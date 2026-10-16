import {
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Собственные списки email-контактов — аудитория рассылки, не привязанная к
 * CRM: наполняются импортом CSV или вручную на странице /email-lists.
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
		email: text("email").notNull(),
		name: text("name"),
		source: text("source").notNull(), // csv | manual
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("email_list_contacts_list_email_idx").on(
			table.listId,
			table.email,
		),
		index("email_list_contacts_list_created_idx").on(
			table.listId,
			table.createdAt,
		),
	],
);
