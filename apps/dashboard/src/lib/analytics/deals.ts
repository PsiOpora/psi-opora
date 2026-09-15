import {
	getDealDictionaryNames,
	getDealStageNames,
} from "@psi-opora/db/queries";

export interface StageInfo {
	name: string;
	sort: number;
}

/**
 * Справочники источников/стадий/воронок сделок — из локального зеркала
 * (packages/db, таблица deal_dictionaries), синкается вместе со сделками
 * (packages/jobs/src/deals-sync.ts::syncDealDictionaries) вместо live
 * crm.status.list/crm.category.list на каждый просмотр отчёта.
 */
export async function fetchSourceNames(): Promise<Map<string, string>> {
	return getDealDictionaryNames("source");
}

export async function fetchCategoryNames(): Promise<Map<string, string>> {
	return getDealDictionaryNames("category");
}

export async function fetchFailReasonNames(): Promise<Map<string, string>> {
	return getDealDictionaryNames("failReason");
}

export async function fetchStageNames(): Promise<Map<string, StageInfo>> {
	return getDealStageNames();
}
