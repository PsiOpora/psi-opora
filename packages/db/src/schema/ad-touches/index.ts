import {
	index,
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
