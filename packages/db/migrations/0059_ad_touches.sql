CREATE TABLE "ad_entities" (
	"platform" text NOT NULL,
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ad_entities_platform_kind_external_id_pk" PRIMARY KEY("platform","kind","external_id")
);
--> statement-breakpoint
CREATE TABLE "ad_touches" (
	"id" text PRIMARY KEY NOT NULL,
	"ym_client_id" text,
	"yclid" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"ad_campaign_id" text,
	"ad_group_id" text,
	"ad_id" text,
	"keyword_id" text,
	"landing_url" text,
	"referrer" text,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_touches" (
	"deal_id" text NOT NULL,
	"touch_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "deal_touches_deal_id_touch_id_pk" PRIMARY KEY("deal_id","touch_id")
);
--> statement-breakpoint
CREATE INDEX "ad_touches_client_idx" ON "ad_touches" USING btree ("ym_client_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ad_touches_yclid_idx" ON "ad_touches" USING btree ("yclid","occurred_at");--> statement-breakpoint
CREATE INDEX "deal_touches_touch_idx" ON "deal_touches" USING btree ("touch_id");