CREATE TABLE "deals" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"stage_id" text NOT NULL,
	"category_id" text NOT NULL,
	"status" text NOT NULL,
	"opportunity" integer DEFAULT 0 NOT NULL,
	"currency" text,
	"source_id" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"date_create" timestamp NOT NULL,
	"close_date" timestamp,
	"date_modify" timestamp NOT NULL,
	"synced_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "deals_date_create_idx" ON "deals" USING btree ("date_create");--> statement-breakpoint
CREATE INDEX "deals_status_idx" ON "deals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deals_stage_idx" ON "deals" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX "deals_category_idx" ON "deals" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "deals_source_idx" ON "deals" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "deals_utm_source_idx" ON "deals" USING btree ("utm_source");--> statement-breakpoint
CREATE INDEX "deals_date_modify_idx" ON "deals" USING btree ("date_modify");