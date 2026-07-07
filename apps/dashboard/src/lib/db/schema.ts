import { pgTable, text, integer, bigint, timestamp } from "drizzle-orm/pg-core";

export const adCredentials = pgTable("ad_credentials", {
  id: text("id").primaryKey().default("singleton"),
  yandexClientId: text("yandex_client_id"),
  yandexClientSecret: text("yandex_client_secret"),
  yandexRefreshToken: text("yandex_refresh_token"),
  vkAccessToken: text("vk_access_token"),
  vkAdsAccountId: text("vk_ads_account_id"),
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
