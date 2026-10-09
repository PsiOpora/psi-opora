ALTER TABLE "yandex_metrika_goal_events" ALTER COLUMN "sent_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "yandex_metrika_goal_events" ALTER COLUMN "sent_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "yandex_metrika_goal_events" ADD COLUMN "status" text DEFAULT 'sent' NOT NULL;--> statement-breakpoint
-- Existing rows were treated as sent; keep them ineligible for retries.
ALTER TABLE "yandex_metrika_goal_events" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "yandex_metrika_goal_events" ADD COLUMN "claimed_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "yandex_metrika_goal_events" ADD COLUMN "claim_token" text;
