import { sql } from "drizzle-orm";
import {
	boolean,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Маркетинговая кампания — только метка для ссылок на бота: человек переходит
 * по ссылке `t.me/<bot>?start=FREE_vk`, видит обычный сценарий бота, а
 * кодовое слово и площадка уходят в атрибуцию (UTM_CAMPAIGN = code,
 * UTM_SOURCE = площадка). В отличие от bot_guide_campaigns отдельного
 * сценария и выдачи материала нет.
 */
export const marketingCampaigns = pgTable(
	"marketing_campaigns",
	{
		id: text("id").primaryKey(),
		/** Кодовое слово в ссылке (без «_»), уникально без учёта регистра. */
		code: text("code").notNull(),
		title: text("title").notNull(),
		/** Площадки, под которые собраны ссылки: vk, b17, dzen… */
		sources: jsonb("sources").$type<string[]>().notNull().default([]),
		active: boolean("active").notNull().default(true),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [
		// FREE и free — одно слово: поиск в боте регистронезависимый.
		uniqueIndex("marketing_campaigns_code_lower_unique").on(
			sql`lower(${table.code})`,
		),
	],
);
