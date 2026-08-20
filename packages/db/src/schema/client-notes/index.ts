import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Внутренние заметки менеджеров по клиенту — видны только в инбоксе
 * «Клиенты» (apps/clients), клиенту не отправляются. Привязаны к диалогу
 * (messenger + userId), как bot_conversations.
 */
export const clientNotes = pgTable(
	"client_notes",
	{
		id: text("id").primaryKey(),
		messenger: text("messenger").notNull(),
		userId: text("user_id").notNull(),
		text: text("text").notNull(),
		/** Bitrix-ID и имя менеджера, оставившего заметку (null в standalone-режиме). */
		operatorId: text("operator_id"),
		operatorName: text("operator_name"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("client_notes_dialog_idx").on(
			table.messenger,
			table.userId,
			table.createdAt,
		),
	],
);
