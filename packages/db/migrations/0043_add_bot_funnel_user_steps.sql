CREATE TABLE "bot_funnel_user_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"day" text NOT NULL,
	"messenger" text NOT NULL,
	"user_id" text NOT NULL,
	"step" text NOT NULL,
	"source" text DEFAULT '-' NOT NULL,
	"campaign" text DEFAULT '-' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bot_funnel_user_steps_range_idx" ON "bot_funnel_user_steps" USING btree ("step","messenger","day");--> statement-breakpoint
CREATE INDEX "bot_funnel_user_steps_user_idx" ON "bot_funnel_user_steps" USING btree ("messenger","user_id");