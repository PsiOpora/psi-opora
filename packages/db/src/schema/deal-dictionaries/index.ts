import {
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

/**
 * Локальная копия справочников Bitrix24, используемых для подписей в отчётах
 * (crm.status.list ENTITY_ID=SOURCE/DEAL_STAGE*, crm.category.list) — синкается
 * вместе со сделками (packages/jobs/src/deals-sync.ts::syncDealDictionaries).
 * Меняются редко, поэтому отчёты дашборда читают отсюда вместо live-запроса
 * к CRM на каждый просмотр (apps/dashboard/src/lib/analytics/deals.ts).
 */
export const dealDictionaries = pgTable(
	"deal_dictionaries",
	{
		type: text("type").notNull(), // source | category | stage
		id: text("id").notNull(), // STATUS_ID / CATEGORY_ID из Bitrix, как есть
		name: text("name").notNull(),
		sort: integer("sort").notNull().default(0), // только для type=stage
		syncedAt: timestamp("synced_at").defaultNow(),
	},
	(table) => [primaryKey({ columns: [table.type, table.id] })],
);
