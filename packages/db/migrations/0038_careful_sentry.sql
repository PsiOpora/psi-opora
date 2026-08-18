CREATE TABLE "bot_guide_views" (
	"id" text PRIMARY KEY NOT NULL,
	"delivery_id" text,
	"campaign_id" text,
	"guide_id" text,
	"messenger" text NOT NULL,
	"user_id" text NOT NULL,
	"source" text DEFAULT 'chat' NOT NULL,
	"ip" text,
	"user_agent" text,
	"opened_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_guide_deliveries" ADD COLUMN "first_opened_at" timestamp;--> statement-breakpoint
ALTER TABLE "bot_guide_deliveries" ADD COLUMN "last_opened_at" timestamp;--> statement-breakpoint
ALTER TABLE "bot_guide_deliveries" ADD COLUMN "open_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "bot_guide_views_delivery_idx" ON "bot_guide_views" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "bot_guide_views_campaign_idx" ON "bot_guide_views" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "bot_guide_views_user_idx" ON "bot_guide_views" USING btree ("messenger","user_id");--> statement-breakpoint
CREATE INDEX "bot_guide_views_opened_at_idx" ON "bot_guide_views" USING btree ("opened_at");