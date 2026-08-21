CREATE TABLE "deal_stage_history" (
	"id" text PRIMARY KEY NOT NULL,
	"deal_id" text NOT NULL,
	"stage_id" text NOT NULL,
	"stage_semantic_id" text NOT NULL,
	"category_id" text NOT NULL,
	"entered_at" timestamp NOT NULL,
	"synced_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "deal_stage_history_sync" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"last_synced_id" text,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "deal_stage_history_deal_idx" ON "deal_stage_history" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "deal_stage_history_category_entered_idx" ON "deal_stage_history" USING btree ("category_id","entered_at");