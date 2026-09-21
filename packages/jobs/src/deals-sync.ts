import type { BitrixApi } from "@psi-opora/bitrix-client";
import {
	deleteDeal,
	deleteDeals,
	getAllDealIds,
	getSyncWatermark,
	type NewDeal,
	type NewDealDictionaryEntry,
	replaceDealDictionary,
	upsertDeals,
} from "@psi-opora/db/queries";
import { z } from "zod";

/**
 * Поля/нормализация сделки для локального зеркала (packages/db, таблица
 * deals) — 1:1 повторяют apps/dashboard/src/lib/analytics/deals.ts
 * (DEAL_SELECT/normalizeDeal/statusOf/decodeUtmValue), плюс DATE_MODIFY —
 * курсор для инкрементальной сверки (см. syncChangedDeals).
 */
const DEAL_SYNC_SELECT = [
	"ID",
	"TITLE",
	"STAGE_ID",
	"CATEGORY_ID",
	"CLOSED",
	"OPPORTUNITY",
	"CURRENCY_ID",
	"DATE_CREATE",
	"CLOSEDATE",
	"DATE_MODIFY",
	"SOURCE_ID",
	// Поле "Причина провала" — заполняется на стадии "Анализ причины провала".
	"UF_CRM_1779838990",
	// Страница сайта, с которой пришла заявка — заполняется формой на сайте.
	"UF_CRM_PAGE_URL",
	"UTM_SOURCE",
	"UTM_MEDIUM",
	"UTM_CAMPAIGN",
	"UTM_CONTENT",
	"UTM_TERM",
];

interface RawSyncDeal {
	ID: string;
	TITLE: string;
	STAGE_ID: string;
	CATEGORY_ID: string;
	CLOSED: "Y" | "N";
	OPPORTUNITY: string;
	CURRENCY_ID: string;
	DATE_CREATE: string;
	CLOSEDATE?: string;
	DATE_MODIFY: string;
	SOURCE_ID?: string;
	UF_CRM_1779838990?: string | number | null;
	UF_CRM_PAGE_URL?: string | null;
	UTM_SOURCE?: string;
	UTM_MEDIUM?: string;
	UTM_CAMPAIGN?: string;
	UTM_CONTENT?: string;
	UTM_TERM?: string;
}

const remoteDealRowsSchema = z.array(z.object({ ID: z.string() }));

/** Рекламные площадки иногда передают UTM percent-encoded — декодируем для читаемости. */
function decodeUtm(value?: string): string | null {
	if (!value) return null;
	if (!/%[0-9A-Fa-f]{2}/.test(value)) return value;
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/**
 * Bitrix24 не отдаёт единый флаг "сделка выиграна" — только STAGE_ID.
 * Стадии успеха/провала всегда содержат WON/LOSE в коде.
 */
function statusOf(deal: RawSyncDeal): "won" | "lost" | "in_progress" {
	if (deal.CLOSED !== "Y") return "in_progress";
	if (deal.STAGE_ID.includes("WON")) return "won";
	if (deal.STAGE_ID.includes("LOSE")) return "lost";
	return "won";
}

function normalizePageUrl(value: string | null): string | null {
	if (value === null) return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	try {
		const url = new URL(trimmed);
		return url.protocol === "http:" || url.protocol === "https:"
			? trimmed
			: null;
	} catch {
		return null;
	}
}

function normalizeSyncDeal(raw: RawSyncDeal): NewDeal {
	const pageUrl =
		Object.hasOwn(raw, "UF_CRM_PAGE_URL") && raw.UF_CRM_PAGE_URL !== undefined
			? { pageUrl: normalizePageUrl(raw.UF_CRM_PAGE_URL) }
			: {};
	return {
		id: raw.ID,
		title: raw.TITLE,
		stageId: raw.STAGE_ID,
		categoryId: raw.CATEGORY_ID,
		status: statusOf(raw),
		opportunity: Math.round(Number(raw.OPPORTUNITY) || 0),
		currency: raw.CURRENCY_ID || null,
		sourceId: raw.SOURCE_ID || null,
		failReasonId: raw.UF_CRM_1779838990 ? String(raw.UF_CRM_1779838990) : null,
		...pageUrl,
		utmSource: decodeUtm(raw.UTM_SOURCE),
		utmMedium: decodeUtm(raw.UTM_MEDIUM),
		utmCampaign: decodeUtm(raw.UTM_CAMPAIGN),
		utmContent: decodeUtm(raw.UTM_CONTENT),
		utmTerm: decodeUtm(raw.UTM_TERM),
		dateCreate: new Date(raw.DATE_CREATE),
		closeDate: raw.CLOSEDATE ? new Date(raw.CLOSEDATE) : null,
		dateModify: new Date(raw.DATE_MODIFY),
	};
}

/**
 * Периодическая сверка (packages/jobs/src/hatchet/deals-sync.ts, cron):
 * подтягивает сделки, изменённые после последнего известного DATE_MODIFY —
 * подстраховка на случай недоставленного вебхука. Если таблица ещё пуста
 * (watermark отсутствует) — не тянет всю историю (это уронило бы Bitrix REST
 * лимит), а ждёт разового бэкафилла (scripts/backfill-deals.ts).
 */
export async function syncChangedDeals(
	api: BitrixApi,
): Promise<{ synced: number; skipped?: "no_watermark" }> {
	const watermark = await getSyncWatermark();
	if (!watermark) return { synced: 0, skipped: "no_watermark" };

	// Запас на рассинхрон часов/задержку между DATE_MODIFY в Bitrix и коммитом в БД.
	const since = new Date(watermark.getTime() - 5 * 60 * 1000);
	const raw = await api.list<RawSyncDeal>("crm.deal.list", {
		select: DEAL_SYNC_SELECT,
		filter: { ">DATE_MODIFY": since.toISOString() },
		order: { DATE_MODIFY: "ASC" },
	});
	const rows = raw.map(normalizeSyncDeal);
	await upsertDeals(rows);
	return { synced: rows.length };
}

/**
 * Сверка удалений: syncChangedDeals и вебхуки (OnCrmDealAdd/Update) только
 * апсертят — если OnCrmDealDelete не долетел (сбой доставки, даунтайм
 * apps/bitrix-webhook, слетевшая подписка event.bind), сделка навсегда
 * остаётся в зеркале. Здесь сверяем id целиком: тянем из Bitrix только поле
 * ID (лёгкий запрос; bitrix-client прерывает синхронизацию, если не успел
 * пройти всю пагинацию) и удаляем из зеркала то, чего там больше нет.
 */
export async function syncDeletedDeals(
	api: BitrixApi,
): Promise<{ deleted: number }> {
	const localIds = await getAllDealIds();
	if (localIds.length === 0) return { deleted: 0 };

	const remote = remoteDealRowsSchema.parse(
		await api.list<unknown>("crm.deal.list", { select: ["ID"] }),
	);
	const remoteIds = new Set(remote.map((row) => row.ID));
	const staleIds = localIds.filter((id) => !remoteIds.has(id));
	if (staleIds.length === 0) return { deleted: 0 };

	await deleteDeals(staleIds);
	return { deleted: staleIds.length };
}

/**
 * Апсерт одной сделки по id — обработчик вебхуков OnCrmDealAdd/OnCrmDealUpdate
 * (apps/bitrix-webhook). Если сделка уже недоступна (например, её удалили
 * между событием и обработкой) — убирает её из зеркала вместо падения.
 */
export async function syncOneDeal(
	api: BitrixApi,
	dealId: string,
): Promise<{ synced: boolean }> {
	const raw = await api.call<RawSyncDeal | false>("crm.deal.get", {
		id: dealId,
	});
	if (!raw) {
		await deleteDeal(dealId);
		return { synced: false };
	}
	await upsertDeals([normalizeSyncDeal(raw)]);
	return { synced: true };
}

/** Удаление сделки из зеркала — обработчик вебхука OnCrmDealDelete. */
export async function removeSyncedDeal(dealId: string): Promise<void> {
	await deleteDeal(dealId);
}

const statusRowSchema = z.object({
	ENTITY_ID: z.string(),
	STATUS_ID: z.string(),
	NAME: z.string(),
	SORT: z.string(),
});

const categoryResultSchema = z.object({
	categories: z.array(
		z.object({
			id: z.number(),
			name: z.string(),
		}),
	),
});

const dealFieldsSchema = z.record(
	z.string(),
	z
		.object({
			items: z
				.array(
					z.object({
						ID: z.string(),
						VALUE: z.string(),
					}),
				)
				.optional(),
		})
		.optional(),
);

/**
 * Справочники источников/стадий/воронок (packages/db, таблица deal_dictionaries) —
 * подписи для отчётов дашборда читаются отсюда вместо live crm.status.list/
 * crm.category.list на каждый просмотр (apps/dashboard/src/lib/analytics/deals.ts).
 * Меняются редко, поэтому синкаются целиком (replace) вместе со сделками.
 */
export async function syncDealDictionaries(api: BitrixApi): Promise<void> {
	const [statusRows, categoryResult, dealFields] = await Promise.all([
		api.list<{
			ENTITY_ID: string;
			STATUS_ID: string;
			NAME: string;
			SORT: string;
		}>("crm.status.list", {
			select: ["ENTITY_ID", "STATUS_ID", "NAME", "SORT"],
		}),
		api.call<{ categories: Array<{ id: number; name: string }> }>(
			"crm.category.list",
			{ entityTypeId: 2 },
		),
		api.call<Record<string, { items?: Array<{ ID: string; VALUE: string }> }>>(
			"crm.deal.fields",
			{},
		),
	]);

	// Validate responses before processing
	const statusRowsValidation = z.array(statusRowSchema).safeParse(statusRows);
	const categoryResultValidation =
		categoryResultSchema.safeParse(categoryResult);
	const dealFieldsValidation = dealFieldsSchema.safeParse(dealFields);

	if (
		!statusRowsValidation.success ||
		!categoryResultValidation.success ||
		!dealFieldsValidation.success
	) {
		console.error(
			"[syncDealDictionaries] Invalid API response structure, skipping sync to preserve existing dictionaries",
		);
		if (!statusRowsValidation.success) {
			console.error(
				"Status rows validation error:",
				statusRowsValidation.error,
			);
		}
		if (!categoryResultValidation.success) {
			console.error(
				"Category result validation error:",
				categoryResultValidation.error,
			);
		}
		if (!dealFieldsValidation.success) {
			console.error(
				"Deal fields validation error:",
				dealFieldsValidation.error,
			);
		}
		return;
	}

	const sources: NewDealDictionaryEntry[] = [];
	const stages: NewDealDictionaryEntry[] = [];
	for (const row of statusRowsValidation.data) {
		if (row.ENTITY_ID === "SOURCE") {
			sources.push({ type: "source", id: row.STATUS_ID, name: row.NAME });
		} else if (
			row.ENTITY_ID === "DEAL_STAGE" ||
			row.ENTITY_ID.startsWith("DEAL_STAGE_")
		) {
			stages.push({
				type: "stage",
				id: row.STATUS_ID,
				name: row.NAME,
				sort: Number(row.SORT) || 0,
			});
		}
	}
	const categories: NewDealDictionaryEntry[] =
		categoryResultValidation.data.categories.map((c) => ({
			type: "category",
			id: String(c.id),
			name: c.name,
		}));

	// Пункты списка поля "Причина провала" (UF_CRM_1779838990) — не отдаются
	// через crm.status.list (это кастомное UF-поле, не системный справочник).
	const validatedDealFields = dealFieldsValidation.data;
	const failReasonItems = validatedDealFields?.UF_CRM_1779838990?.items;
	const failReasons: NewDealDictionaryEntry[] = Array.isArray(failReasonItems)
		? failReasonItems.map((item) => ({
				type: "failReason",
				id: item.ID,
				name: item.VALUE,
			}))
		: [];

	// Additional check: ensure we have at least some stages (most critical dictionary)
	if (stages.length === 0) {
		console.error(
			"[syncDealDictionaries] No stages returned from API, skipping sync to preserve existing dictionaries",
		);
		return;
	}

	await Promise.all([
		replaceDealDictionary("source", sources),
		replaceDealDictionary("stage", stages),
		replaceDealDictionary("category", categories),
		...(failReasons.length > 0
			? [replaceDealDictionary("failReason", failReasons)]
			: []),
	]);
}

const BACKFILL_BATCH_SIZE = 500;

/**
 * Полная синхронизация — весь список сделок, без фильтра по дате/DATE_MODIFY.
 * Разовый бэкафилл (scripts/backfill-deals.ts) перед первым включением
 * периодической сверки (syncChangedDeals полагается на непустую таблицу).
 */
export async function syncAllDeals(
	api: BitrixApi,
	onProgress?: (synced: number, total: number) => void,
): Promise<{ synced: number }> {
	const raw = await api.list<RawSyncDeal>("crm.deal.list", {
		select: DEAL_SYNC_SELECT,
		order: { ID: "ASC" },
	});
	const rows = raw.map(normalizeSyncDeal);
	for (let i = 0; i < rows.length; i += BACKFILL_BATCH_SIZE) {
		const batch = rows.slice(i, i + BACKFILL_BATCH_SIZE);
		await upsertDeals(batch);
		onProgress?.(Math.min(i + BACKFILL_BATCH_SIZE, rows.length), rows.length);
	}
	return { synced: rows.length };
}
