import type { BitrixApi } from "@/lib/bitrix/client";
import type { DateRange, DealRecord, DealStatus } from "./types";

const DEAL_SELECT = [
	"ID",
	"TITLE",
	"STAGE_ID",
	"CATEGORY_ID",
	"CLOSED",
	"OPPORTUNITY",
	"CURRENCY_ID",
	"DATE_CREATE",
	"CLOSEDATE",
	"SOURCE_ID",
	"UTM_SOURCE",
	"UTM_MEDIUM",
	"UTM_CAMPAIGN",
	"UTM_CONTENT",
	"UTM_TERM",
];

const NOT_SPECIFIED = "(не указано)";

/**
 * Рекламные площадки иногда передают UTM-метки уже percent-encoded
 * (например, кириллицу вида %D0%A0%D0%9A-...), и Bitrix24 сохраняет
 * их в сделке как есть. Декодируем для читаемого отображения в отчётах.
 */
function decodeUtmValue(value: string | undefined): string {
	if (!value) return NOT_SPECIFIED;
	if (!/%[0-9A-Fa-f]{2}/.test(value)) return value;
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

interface RawDeal {
	ID: string;
	TITLE: string;
	STAGE_ID: string;
	CATEGORY_ID: string;
	CLOSED: "Y" | "N";
	OPPORTUNITY: string;
	CURRENCY_ID: string;
	DATE_CREATE: string;
	CLOSEDATE?: string;
	SOURCE_ID?: string;
	UTM_SOURCE?: string;
	UTM_MEDIUM?: string;
	UTM_CAMPAIGN?: string;
	UTM_CONTENT?: string;
	UTM_TERM?: string;
}

/**
 * Bitrix24 не отдаёт единый флаг "сделка выиграна" — только STAGE_ID,
 * специфичный для конкретной воронки (CATEGORY_ID). По соглашению Битрикс24
 * стадии успеха/провала всегда содержат WON/LOSE в коде (стандартная
 * воронка: "WON"/"LOSE", остальные: "C{id}:WON"/"C{id}:LOSE").
 */
function statusOf(deal: RawDeal): DealStatus {
	if (deal.CLOSED !== "Y") return "in_progress";
	if (deal.STAGE_ID.includes("WON")) return "won";
	if (deal.STAGE_ID.includes("LOSE")) return "lost";
	return "won";
}

function normalizeDeal(raw: RawDeal): DealRecord {
	return {
		id: raw.ID,
		title: raw.TITLE,
		stageId: raw.STAGE_ID,
		categoryId: raw.CATEGORY_ID,
		status: statusOf(raw),
		opportunity: Number(raw.OPPORTUNITY) || 0,
		currency: raw.CURRENCY_ID,
		dateCreate: new Date(raw.DATE_CREATE),
		closeDate: raw.CLOSEDATE ? new Date(raw.CLOSEDATE) : null,
		sourceId: raw.SOURCE_ID || NOT_SPECIFIED,
		utmSource: decodeUtmValue(raw.UTM_SOURCE),
		utmMedium: decodeUtmValue(raw.UTM_MEDIUM),
		utmCampaign: decodeUtmValue(raw.UTM_CAMPAIGN),
		utmContent: decodeUtmValue(raw.UTM_CONTENT),
		utmTerm: decodeUtmValue(raw.UTM_TERM),
	};
}

export async function fetchDeals(
	api: BitrixApi,
	range: DateRange,
): Promise<DealRecord[]> {
	const raw = await api.list<RawDeal>("crm.deal.list", {
		select: DEAL_SELECT,
		filter: {
			">=DATE_CREATE": range.from.toISOString(),
			"<=DATE_CREATE": range.to.toISOString(),
		},
		order: { DATE_CREATE: "ASC" },
	});
	return raw.map(normalizeDeal);
}

/**
 * Сделки, которые сейчас находятся в работе (не закрыты), без фильтра по
 * дате создания — снэпшот текущего состояния воронки, как в канбане Bitrix24
 * по умолчанию.
 */
export async function fetchOpenDeals(api: BitrixApi): Promise<DealRecord[]> {
	const raw = await api.list<RawDeal>("crm.deal.list", {
		select: DEAL_SELECT,
		filter: { CLOSED: "N" },
		order: { DATE_CREATE: "ASC" },
	});
	return raw.map(normalizeDeal);
}

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
