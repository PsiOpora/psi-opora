import type { BitrixApi } from "@/lib/bitrix/client";

export interface SourceName {
	id: string;
	name: string;
}

export async function fetchSourceNames(
	api: BitrixApi,
): Promise<Map<string, string>> {
	const rows = await api.list<{ STATUS_ID: string; NAME: string }>(
		"crm.status.list",
		{
			filter: { ENTITY_ID: "SOURCE" },
			select: ["STATUS_ID", "NAME"],
		},
	);
	return new Map(rows.map((row) => [row.STATUS_ID, row.NAME]));
}

export interface StageInfo {
	name: string;
	sort: number;
}

/**
 * Справочник стадий всех воронок сделок: ключ — STAGE_ID сделки
 * (ENTITY_ID "DEAL_STAGE" для основной воронки, "DEAL_STAGE_{id}" для остальных).
 */
export async function fetchStageNames(
	api: BitrixApi,
): Promise<Map<string, StageInfo>> {
	const rows = await api.list<{
		ENTITY_ID: string;
		STATUS_ID: string;
		NAME: string;
		SORT: string;
	}>("crm.status.list", { select: ["ENTITY_ID", "STATUS_ID", "NAME", "SORT"] });
	const stages = new Map<string, StageInfo>();
	for (const row of rows) {
		if (
			row.ENTITY_ID === "DEAL_STAGE" ||
			row.ENTITY_ID.startsWith("DEAL_STAGE_")
		) {
			stages.set(row.STATUS_ID, {
				name: row.NAME,
				sort: Number(row.SORT) || 0,
			});
		}
	}
	return stages;
}

/** Названия воронок сделок (категорий): ключ — CATEGORY_ID сделки. */
export async function fetchCategoryNames(
	api: BitrixApi,
): Promise<Map<string, string>> {
	const result = await api.call<{
		categories: Array<{ id: number; name: string }>;
	}>("crm.category.list", {
		entityTypeId: 2,
	});
	return new Map(result.categories.map((c) => [String(c.id), c.name]));
}
