import {
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

/**
 * Касание с рекламой: один заход посетителя на сайт по рекламной ссылке
 * (UTM-метки / yclid / макросы Директа). Сайт (вне этого репозитория) шлёт
 * их на POST /api/track-touch (apps/bitrix-webhook), ключ связи с ботом —
 * ClientID Яндекс.Метрики, который бот и так получает суффиксом `_ym…` в
 * start-параметре (см. packages/bot-core/src/utils/utm.ts). Благодаря этому
 * при создании сделки видна вся цепочка касаний, а не одна метка, и не
 * упираемся в лимит start-параметра мессенджера (64 символа).
 */
export const adTouches = pgTable(
	"ad_touches",
	{
		id: text("id").primaryKey(),
		ymClientId: text("ym_client_id"),
		yclid: text("yclid"),
		utmSource: text("utm_source"),
		utmMedium: text("utm_medium"),
		utmCampaign: text("utm_campaign"),
		utmContent: text("utm_content"),
		utmTerm: text("utm_term"),
		// ID сущностей рекламного кабинета (Директ): из макросов ссылки
		// {campaign_id}/{gbid}/{ad_id}/{phrase_id} либо выведены из utm_*.
		adCampaignId: text("ad_campaign_id"),
		adGroupId: text("ad_group_id"),
		adId: text("ad_id"),
		keywordId: text("keyword_id"),
		// Обстоятельства показа из макросов Директа: {region_name}/{region_id}
		// (регион показа), {position}/{position_type} (место объявления в блоке
		// выдачи, 0/none — сети), {source_type} (search | context),
		// {device_type} (desktop | mobile | tablet).
		regionName: text("region_name"),
		regionId: text("region_id"),
		adPosition: text("ad_position"),
		adPositionType: text("ad_position_type"),
		sourceType: text("source_type"),
		deviceType: text("device_type"),
		landingUrl: text("landing_url"),
		referrer: text("referrer"),
		occurredAt: timestamp("occurred_at").notNull().defaultNow(),
	},
	(table) => [
		index("ad_touches_client_idx").on(table.ymClientId, table.occurredAt),
		index("ad_touches_yclid_idx").on(table.yclid, table.occurredAt),
	],
);

/**
 * Справочник сущностей рекламного кабинета (кампания/группа/объявление/
 * ключевая фраза) — названия подтягиваются из API Директа лениво и кэшируются:
 * в UTM-метках приходят только числовые ID, а в Bitrix нужны читаемые
 * названия. Один ряд на (платформа, вид, внешний ID).
 */
export const adEntities = pgTable(
	"ad_entities",
	{
		platform: text("platform").notNull(),
		// campaign | group | ad | keyword
		kind: text("kind").notNull(),
		externalId: text("external_id").notNull(),
		// Для объявления — заголовок, для ключа — текст фразы.
		name: text("name").notNull(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.platform, table.kind, table.externalId] }),
	],
);

/**
 * Какие касания участвовали в атрибуции сделки (снимок на момент создания).
 * Нужен для отчётов по касаниям (первое/последнее) без пересчёта задним
 * числом — touch-записи у клиента продолжают накапливаться и после сделки.
 */
export const dealTouches = pgTable(
	"deal_touches",
	{
		dealId: text("deal_id").notNull(),
		touchId: text("touch_id").notNull(),
		// first | middle | last — роль касания в цепочке; единственное
		// касание помечается как first и last сразу, поэтому "first_last".
		role: text("role").notNull(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => [
		primaryKey({ columns: [table.dealId, table.touchId] }),
		index("deal_touches_touch_idx").on(table.touchId),
	],
);

/**
 * Поиск запроса, по которому клиент кликнул по объявлению. Макроса с запросом
 * у Директа нет, а Метрика скрывает поисковые фразы в выборках меньше 10
 * посетителей, поэтому запрос берётся из отчёта Директа по поисковым запросам
 * (SEARCH_QUERY_PERFORMANCE_REPORT) за день клика по группе/объявлению/ключу
 * последнего касания. Отчёт появляется с задержкой — запись ждёт крона
 * ads-sync (packages/jobs/src/hatchet/ads-sync.ts). Одна запись на сделку.
 */
export const adSearchQueryLookups = pgTable(
	"ad_search_query_lookups",
	{
		dealId: text("deal_id").primaryKey(), // ID сделки в Bitrix24, как есть
		touchId: text("touch_id").notNull(),
		// Канал бота, создавшего сделку, — им же пишется результат в Bitrix.
		messenger: text("messenger").notNull(),
		status: text("status", { enum: ["pending", "found", "not_found"] })
			.notNull()
			.default("pending"),
		// Один запрос или несколько вероятных через « / ».
		query: text("query"),
		attempts: integer("attempts").notNull().default(0),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		resolvedAt: timestamp("resolved_at"),
	},
	(table) => [index("ad_search_query_lookups_status_idx").on(table.status)],
);
