CREATE TABLE "ad_campaign_id_overrides" (
	"utm_campaign" text PRIMARY KEY NOT NULL,
	"ad_campaign_id" text NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
