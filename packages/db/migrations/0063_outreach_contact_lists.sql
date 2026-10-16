CREATE TABLE "outreach_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"list_id" text,
	"list_name" text,
	"member_id" text NOT NULL,
	"message" text NOT NULL,
	"accounts" jsonb NOT NULL,
	"interval_sec" integer NOT NULL,
	"email_template_id" text,
	"email_template_name" text,
	"email_subject" text,
	"email_sender_email" text,
	"email_sender_name" text,
	"email_provider" text,
	"public_base_url" text,
	"email_campaign_id" text,
	"status" text NOT NULL,
	"recipients_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "outreach_recipients" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"list_contact_id" text,
	"name" text,
	"phone" text,
	"email" text,
	"status" text NOT NULL,
	"channel" text,
	"attempts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_id" text,
	"email_recipient_id" text,
	"error" text,
	"sent_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_list_contacts" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "email_list_contacts" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "outreach_campaigns" ADD CONSTRAINT "outreach_campaigns_list_id_email_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."email_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_campaigns" ADD CONSTRAINT "outreach_campaigns_email_campaign_id_email_campaigns_id_fk" FOREIGN KEY ("email_campaign_id") REFERENCES "public"."email_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_recipients" ADD CONSTRAINT "outreach_recipients_campaign_id_outreach_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."outreach_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outreach_recipients_campaign_status_idx" ON "outreach_recipients" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "outreach_recipients_phone_idx" ON "outreach_recipients" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "outreach_recipients_email_idx" ON "outreach_recipients" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "email_list_contacts_list_phone_idx" ON "email_list_contacts" USING btree ("list_id","phone");--> statement-breakpoint
ALTER TABLE "email_list_contacts" ADD CONSTRAINT "email_list_contacts_email_or_phone" CHECK ("email_list_contacts"."email" is not null or "email_list_contacts"."phone" is not null);