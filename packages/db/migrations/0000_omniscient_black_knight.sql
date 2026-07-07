CREATE TABLE "ad_credentials" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"yandex_client_id" text,
	"yandex_client_secret" text,
	"yandex_refresh_token" text,
	"vk_access_token" text,
	"vk_ads_account_id" text,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ad_daily_stats" (
	"id" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"campaign_id" text NOT NULL,
	"campaign_name" text,
	"date" text NOT NULL,
	"impressions" integer DEFAULT 0,
	"clicks" integer DEFAULT 0,
	"spend" integer DEFAULT 0,
	"fetched_at" timestamp DEFAULT now()
);
