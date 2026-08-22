import {
	index,
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

/**
 * Один и тот же пользователь мессенджера дошёл до шага воронки в конкретный
 * день — строка добавляется не более одного раза за день (id включает day,
 * messenger, userId, step), поэтому повторные /start от одного человека в
 * один день не размножают запись. За произвольный диапазон дат это даёт
 * настоящие уникальные значения через COUNT(DISTINCT user_id) — см.
 * getBotFunnelUniqueStepCounts / getBotFunnelStepClients.
 */
export const botFunnelUserSteps = pgTable(
	"bot_funnel_user_steps",
	{
		id: text("id").primaryKey(),
		day: text("day").notNull(),
		messenger: text("messenger").notNull(),
		userId: text("user_id").notNull(),
		step: text("step").notNull(),
		source: text("source").notNull().default("-"),
		campaign: text("campaign").notNull().default("-"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("bot_funnel_user_steps_range_idx").on(
			table.step,
			table.messenger,
			table.day,
		),
		index("bot_funnel_user_steps_user_idx").on(table.messenger, table.userId),
	],
);
