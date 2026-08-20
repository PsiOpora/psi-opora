import {
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

export const botFunnelEvents = pgTable(
	"bot_funnel_events",
	{
		id: text("id").primaryKey(),
		day: text("day").notNull(),
		messenger: text("messenger").notNull(),
		step: text("step").notNull(),
		source: text("source").notNull().default("-"),
		campaign: text("campaign").notNull().default("-"),
		count: integer("count").notNull().default(1),
		updatedAt: timestamp("updated_at").defaultNow(),
	},
	(table) => [
		uniqueIndex("bot_funnel_events_unique_idx").on(
			table.day,
			table.messenger,
			table.step,
			table.source,
			table.campaign,
		),
	],
);
