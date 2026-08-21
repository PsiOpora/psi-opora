import type { BitrixApi } from "@psi-opora/bitrix-client";
import {
	getSyncCursor,
	insertDealStageHistoryEvents,
	type NewDealStageHistoryEvent,
	setSyncCursor,
} from "@psi-opora/db/queries";

const DEAL_ENTITY_TYPE_ID = 2;

const STAGE_HISTORY_SELECT = [
	"ID",
	"OWNER_ID",
	"STAGE_ID",
	"STAGE_SEMANTIC_ID",
	"CATEGORY_ID",
	"CREATED_TIME",
];

interface RawStageHistoryEvent {
	ID: string;
	OWNER_ID: string;
	STAGE_ID: string;
	STAGE_SEMANTIC_ID: string;
	CATEGORY_ID: string;
	CREATED_TIME: string;
}

function normalizeEvent(raw: RawStageHistoryEvent): NewDealStageHistoryEvent {
	return {
		id: raw.ID,
		dealId: raw.OWNER_ID,
		stageId: raw.STAGE_ID,
		stageSemanticId: raw.STAGE_SEMANTIC_ID,
		categoryId: raw.CATEGORY_ID,
		enteredAt: new Date(raw.CREATED_TIME),
	};
}

/**
 * Инкрементальная синхронизация истории стадий (crm.stagehistory.list,
 * packages/db, таблица deal_stage_history). Курсор — deal_stage_history_sync
 * (ID Bitrix24, монотонный по порталу). Тот же путь обслуживает и бэкафилл
 * (курсор отсутствует → "0"), и периодическую докрутку (packages/jobs/src/
 * hatchet/deal-stage-history-sync.ts, cron) — crm.stagehistory.list с ">ID"
 * либо отдаёт всю историю с нуля, либо только новое, в зависимости от курсора.
 */
export async function syncStageHistory(
	api: BitrixApi,
	onProgress?: (synced: number) => void,
): Promise<{ synced: number }> {
	let cursor = (await getSyncCursor()) ?? "0";
	let synced = 0;

	for (;;) {
		const raw = await api.call<{ items: RawStageHistoryEvent[] }>(
			"crm.stagehistory.list",
			{
				entityTypeId: DEAL_ENTITY_TYPE_ID,
				filter: { ">ID": cursor },
				order: { ID: "ASC" },
				select: STAGE_HISTORY_SELECT,
			},
		);
		const items = raw.items ?? [];
		if (items.length === 0) break;

		await insertDealStageHistoryEvents(items.map(normalizeEvent));
		cursor = items[items.length - 1]?.ID ?? cursor; // ASC ⇒ последний = максимальный
		await setSyncCursor(cursor);
		synced += items.length;
		onProgress?.(synced);
	}

	return { synced };
}
