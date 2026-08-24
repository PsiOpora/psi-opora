import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Локальное зеркало сделок Bitrix24 (`crm.deal`) — держится в актуальном
 * состоянии вебхуками (OnCrmDealAdd/Update/Delete, apps/bitrix-webhook) и
 * периодической сверкой по DATE_MODIFY (packages/jobs/src/hatchet/deals-sync.ts).
 * Отчёты дашборда читают отсюда вместо live crm.deal.list на каждый просмотр.
 */
export const deals = pgTable(
	"deals",
	{
		id: text("id").primaryKey(), // ID сделки в Bitrix24, как есть
		title: text("title").notNull(),
		stageId: text("stage_id").notNull(),
		categoryId: text("category_id").notNull(),
		status: text("status").notNull(), // won | lost | in_progress
		opportunity: integer("opportunity").notNull().default(0),
		currency: text("currency"),
		sourceId: text("source_id"),
		// Значение поля "Причина провала" (UF_CRM_1779838990) — заполняется на
		// стадии "Анализ причины провала" воронки. ID пункта списка Bitrix, имя —
		// в deal_dictionaries (type=failReason).
		failReasonId: text("fail_reason_id"),
		utmSource: text("utm_source"),
		utmMedium: text("utm_medium"),
		utmCampaign: text("utm_campaign"),
		utmContent: text("utm_content"),
		utmTerm: text("utm_term"),
		dateCreate: timestamp("date_create").notNull(),
		closeDate: timestamp("close_date"),
		// DATE_MODIFY из Bitrix — курсор для инкрементальной сверки (deals-sync).
		dateModify: timestamp("date_modify").notNull(),
		syncedAt: timestamp("synced_at").defaultNow(),
	},
	(table) => [
		index("deals_date_create_idx").on(table.dateCreate),
		index("deals_status_idx").on(table.status),
		index("deals_stage_idx").on(table.stageId),
		index("deals_category_idx").on(table.categoryId),
		index("deals_source_idx").on(table.sourceId),
		index("deals_fail_reason_idx").on(table.failReasonId),
		index("deals_utm_source_idx").on(table.utmSource),
		index("deals_date_modify_idx").on(table.dateModify),
	],
);
