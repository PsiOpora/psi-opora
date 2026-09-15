ALTER TABLE "bot_funnel_user_steps" ADD COLUMN "flow" text DEFAULT '-' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_funnel_user_steps" ADD COLUMN "reason" text DEFAULT '-' NOT NULL;