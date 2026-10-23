CREATE TABLE "ad_search_query_lookups" (
	"deal_id" text PRIMARY KEY NOT NULL,
	"touch_id" text NOT NULL,
	"messenger" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"query" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "ad_touches" ADD COLUMN "region_name" text;--> statement-breakpoint
ALTER TABLE "ad_touches" ADD COLUMN "region_id" text;--> statement-breakpoint
ALTER TABLE "ad_touches" ADD COLUMN "ad_position" text;--> statement-breakpoint
ALTER TABLE "ad_touches" ADD COLUMN "ad_position_type" text;--> statement-breakpoint
ALTER TABLE "ad_touches" ADD COLUMN "source_type" text;--> statement-breakpoint
ALTER TABLE "ad_touches" ADD COLUMN "device_type" text;--> statement-breakpoint
ALTER TABLE "yandex_metrika_settings" ADD COLUMN "bitrix_ad_deal_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "ad_search_query_lookups_status_idx" ON "ad_search_query_lookups" USING btree ("status");