import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Локальная копия истории переходов сделок по стадиям (crm.stagehistory.list,
 * entityTypeId=2) — синкается packages/jobs/src/deal-stage-history-sync.ts.
 * Append-only: Bitrix не меняет и не удаляет уже созданные записи истории.
 * id — ID записи из Bitrix24 (глобально монотонный по порталу) как есть,
 * текстом: одновременно ключ идемпотентности вставки и курсор синка.
 */
export const dealStageHistory = pgTable(
	"deal_stage_history",
	{
		id: text("id").primaryKey(), // Bitrix crm.stagehistory ID
		dealId: text("deal_id").notNull(), // OWNER_ID
		stageId: text("stage_id").notNull(), // STAGE_ID
		stageSemanticId: text("stage_semantic_id").notNull(), // P|S|F
		categoryId: text("category_id").notNull(), // CATEGORY_ID
		enteredAt: timestamp("entered_at").notNull(), // CREATED_TIME
		syncedAt: timestamp("synced_at").defaultNow(),
	},
	(table) => [
		index("deal_stage_history_deal_idx").on(table.dealId),
		index("deal_stage_history_category_entered_idx").on(
			table.categoryId,
			table.enteredAt,
		),
	],
);

/**
 * Курсор инкрементальной синхронизации — синглтон-строка. id записи истории —
 * text, поэтому MAX(id) как watermark (как getSyncWatermark() у deals через
 * DATE_MODIFY) дал бы неверный лексикографический порядок при росте числа
 * цифр. Курсор хранится отдельно и продвигается job'ом после каждой успешно
 * вставленной пачки.
 */
export const dealStageHistorySync = pgTable("deal_stage_history_sync", {
	id: text("id").primaryKey().default("singleton"),
	lastSyncedId: text("last_synced_id"), // null = нужен бэкафилл с нуля
	updatedAt: timestamp("updated_at").defaultNow(),
});
