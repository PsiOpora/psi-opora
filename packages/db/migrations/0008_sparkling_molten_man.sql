CREATE TABLE "email_campaign_recipients" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"contact_name" text,
	"deal_id" text,
	"deal_title" text,
	"email" text,
	"status" text NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "email_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"stage_id" text NOT NULL,
	"stage_name" text,
	"template_id" text NOT NULL,
	"template_name" text,
	"subject" text NOT NULL,
	"sender_email" text NOT NULL,
	"sender_name" text,
	"status" text NOT NULL,
	"unisender_list_id" text,
	"unisender_message_id" text,
	"unisender_campaign_id" text,
	"total_deals" integer,
	"recipients_count" integer,
	"sent_count" integer,
	"opened_count" integer,
	"clicked_count" integer,
	"unsubscribed_count" integer,
	"error" text,
	"started_at" timestamp DEFAULT now(),
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "unisender_settings" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"api_key" text,
	"sender_email" text,
	"sender_name" text,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" ADD CONSTRAINT "email_campaign_recipients_campaign_id_email_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."email_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_campaign_recipients_campaign_idx" ON "email_campaign_recipients" USING btree ("campaign_id");