import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const broadcasts = pgTable("broadcasts", {
	id: text("id").primaryKey(),
	stageId: text("stage_id").notNull(),
	stageName: text("stage_name"),
	channel: text("channel").notNull(), // auto | telegram | max
	message: text("message").notNull(),
	status: text("status").notNull(), // running | done | error
	totalDeals: integer("total_deals"),
	sentCount: integer("sent_count").notNull().default(0),
	skippedCount: integer("skipped_count").notNull().default(0),
	failedCount: integer("failed_count").notNull().default(0),
	error: text("error"),
	startedAt: timestamp("started_at").defaultNow(),
	finishedAt: timestamp("finished_at"),
});

export const broadcastRecipients = pgTable(
	"broadcast_recipients",
	{
		id: text("id").primaryKey(),
		broadcastId: text("broadcast_id")
			.notNull()
			.references(() => broadcasts.id, { onDelete: "cascade" }),
		contactId: text("contact_id").notNull(),
		contactName: text("contact_name"),
		dealId: text("deal_id"),
		dealTitle: text("deal_title"),
		messenger: text("messenger"), // telegram | max
		messengerUserId: text("messenger_user_id"),
		status: text("status").notNull(), // sent | skipped | error
		error: text("error"),
		sentAt: timestamp("sent_at"),
	},
	(table) => [
		index("broadcast_recipients_broadcast_idx").on(table.broadcastId),
	],
);
