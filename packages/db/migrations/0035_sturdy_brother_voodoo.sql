CREATE TABLE "bot_guide_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"keyword" text NOT NULL,
	"title" text NOT NULL,
	"guide_id" text,
	"email_subject" text NOT NULL,
	"email_body" text NOT NULL,
	"delivery_message" text NOT NULL,
	"follow_up_delay_days" integer DEFAULT 2 NOT NULL,
	"follow_up_message" text NOT NULL,
	"diagnostic_cta_text" text DEFAULT 'Согласен/согласна на диагностику' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bot_guide_campaigns_keyword_unique" UNIQUE("keyword")
);
--> statement-breakpoint
CREATE TABLE "bot_guide_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"messenger" text NOT NULL,
	"user_id" text NOT NULL,
	"chat_id" text,
	"deal_id" integer,
	"name" text,
	"phone" text,
	"email" text,
	"delivered_at" timestamp DEFAULT now() NOT NULL,
	"follow_up_sent_at" timestamp,
	"diagnostic_requested_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "bot_guide_campaigns" ADD CONSTRAINT "bot_guide_campaigns_guide_id_bot_guides_id_fk" FOREIGN KEY ("guide_id") REFERENCES "public"."bot_guides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_guide_deliveries" ADD CONSTRAINT "bot_guide_deliveries_campaign_id_bot_guide_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."bot_guide_campaigns"("id") ON DELETE no action ON UPDATE no action;