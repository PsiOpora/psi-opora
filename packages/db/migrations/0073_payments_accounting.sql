CREATE TABLE "payment_products" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"price_kopecks" integer NOT NULL,
	"sessions_count" integer,
	"valid_days" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_total_field" text,
	"contact_last_paid_field" text,
	"deal_paid_field" text,
	"deal_paid_stage_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"amount_kopecks" integer NOT NULL,
	"status" text DEFAULT 'paid' NOT NULL,
	"paid_at" timestamp NOT NULL,
	"payer_name" text,
	"payer_inn" text,
	"purpose" text,
	"match_status" text NOT NULL,
	"contact_id" text,
	"deal_id" text,
	"purchase_id" text,
	"bitrix_synced_at" timestamp,
	"raw" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"deal_id" text,
	"product_id" text,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"amount_kopecks" integer NOT NULL,
	"sessions_total" integer,
	"sessions_used" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "payments_source_external_idx" ON "payments" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "payments_contact_idx" ON "payments" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "payments_purchase_idx" ON "payments" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "payments_match_status_idx" ON "payments" USING btree ("match_status");--> statement-breakpoint
CREATE INDEX "purchases_contact_idx" ON "purchases" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE INDEX "purchases_deal_idx" ON "purchases" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "purchases_status_idx" ON "purchases" USING btree ("status");