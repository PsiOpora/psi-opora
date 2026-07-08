CREATE TABLE "bot_funnel_events" (
	"id" text PRIMARY KEY NOT NULL,
	"day" text NOT NULL,
	"messenger" text NOT NULL,
	"step" text NOT NULL,
	"source" text DEFAULT '-' NOT NULL,
	"campaign" text DEFAULT '-' NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bot_funnel_events_unique_idx" ON "bot_funnel_events" USING btree ("day","messenger","step","source","campaign");