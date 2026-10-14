CREATE TABLE "email_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"campaign_id" text,
	"recipient_id" text,
	"email" text,
	"type" text NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"details" text,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_list_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"list_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_lists" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"email" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"campaign_id" text,
	"details" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" ALTER COLUMN "contact_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "email_campaigns" ALTER COLUMN "stage_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" ADD COLUMN "provider_message_id" text;--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" ADD COLUMN "sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" ADD COLUMN "delivered_at" timestamp;--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" ADD COLUMN "opened_at" timestamp;--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" ADD COLUMN "clicked_at" timestamp;--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" ADD COLUMN "bounced_at" timestamp;--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" ADD COLUMN "complained_at" timestamp;--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" ADD COLUMN "unsubscribed_at" timestamp;--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" ADD COLUMN "open_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" ADD COLUMN "click_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" ADD COLUMN "last_event_at" timestamp;--> statement-breakpoint
ALTER TABLE "email_campaign_recipients" ADD COLUMN "tracking_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD COLUMN "audience" text DEFAULT 'crm_stage' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD COLUMN "list_id" text;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD COLUMN "list_name" text;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD COLUMN "public_base_url" text;--> statement-breakpoint
ALTER TABLE "rusender_settings" ADD COLUMN "webhook_secret" text;--> statement-breakpoint
ALTER TABLE "email_list_contacts" ADD CONSTRAINT "email_list_contacts_list_id_email_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."email_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_events_provider_external_idx" ON "email_events" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "email_events_recipient_idx" ON "email_events" USING btree ("recipient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_list_contacts_list_email_idx" ON "email_list_contacts" USING btree ("list_id","email");--> statement-breakpoint
CREATE INDEX "email_list_contacts_list_created_idx" ON "email_list_contacts" USING btree ("list_id","created_at");--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_list_id_email_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."email_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_campaign_recipients_campaign_email_idx" ON "email_campaign_recipients" USING btree ("campaign_id","email");--> statement-breakpoint
CREATE INDEX "email_campaign_recipients_provider_message_idx" ON "email_campaign_recipients" USING btree ("provider_message_id");