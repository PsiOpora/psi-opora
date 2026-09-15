ALTER TABLE "bot_users" ADD COLUMN "presence_status" text;--> statement-breakpoint
ALTER TABLE "bot_users" ADD COLUMN "messenger_last_seen_at" timestamp;--> statement-breakpoint
ALTER TABLE "bot_users" ADD COLUMN "presence_observed_at" timestamp;