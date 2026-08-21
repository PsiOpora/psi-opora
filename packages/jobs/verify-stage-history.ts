import { resolveBitrixApi, type BitrixApi } from "@psi-opora/bitrix-client";
import { env } from "@psi-opora/config";
import {
	getSyncCursor,
	insertDealStageHistoryEvents,
	type NewDealStageHistoryEvent,
	setSyncCursor,
} from "../db/src/queries/deal-stage-history";

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

async function syncStageHistory(api: BitrixApi) {
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
		cursor = items[items.length - 1]?.ID ?? cursor;
		await setSyncCursor(cursor);
		synced += items.length;
		console.log(`  синхронизировано ${synced}`);
	}
	return { synced };
}

async function main() {
	const api = resolveBitrixApi(env.BITRIX_MEMBER_ID);
	if (!api) throw new Error("Bitrix24 не подключён");
	console.log("Бэкафилл истории стадий сделок — старт…");
	const result = await syncStageHistory(api);
	console.log(`Готово: ${result.synced} записей истории.`);
}

await main();
