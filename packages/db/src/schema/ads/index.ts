import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const adCredentials = pgTable("ad_credentials", {
	id: text("id").primaryKey().default("singleton"),
	yandexClientId: text("yandex_client_id"),
	yandexClientSecret: text("yandex_client_secret"),
	yandexRefreshToken: text("yandex_refresh_token"),
	updatedAt: timestamp("updated_at").defaultNow(),
});

export const adDailyStats = pgTable("ad_daily_stats", {
	id: text("id").primaryKey(),
	platform: text("platform").notNull(),
	campaignId: text("campaign_id").notNull(),
	campaignName: text("campaign_name"),
	date: text("date").notNull(),
	impressions: integer("impressions").default(0),
	clicks: integer("clicks").default(0),
	spend: integer("spend").default(0),
	fetchedAt: timestamp("fetched_at").defaultNow(),
});

/**
 * Ручная привязка UTM-кампании (utm_campaign как она приходит в сделках) к
 * актуальному ID кампании в рекламном кабинете — перекрывает автоматический
 * матчинг по числовому ID в имени (см. apps/dashboard/src/lib/analytics/ad-spend-match.ts).
 * Нужна, когда кампанию пересоздали в кабинете (новый ID), а трекинговую
 * ссылку с старым ID менять не стали — без этой привязки расход по такой
 * кампании навсегда остаётся "не привязано к UTM-кампании".
 */
export const adCampaignIdOverrides = pgTable("ad_campaign_id_overrides", {
	utmCampaign: text("utm_campaign").primaryKey(),
	adCampaignId: text("ad_campaign_id").notNull(),
	updatedAt: timestamp("updated_at").defaultNow(),
});
