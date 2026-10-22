ALTER TABLE "outreach_campaigns" ADD COLUMN "settings" jsonb;--> statement-breakpoint
ALTER TABLE "outreach_campaigns" ADD COLUMN "resume_at" timestamp;--> statement-breakpoint
ALTER TABLE "outreach_campaigns" ADD COLUMN "pause_reason" text;