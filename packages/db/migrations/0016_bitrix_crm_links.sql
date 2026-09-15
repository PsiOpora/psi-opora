CREATE TABLE "bitrix_crm_links" (
	"id" text PRIMARY KEY NOT NULL,
	"messenger" text NOT NULL,
	"user_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"deal_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bitrix_crm_links_dialog_idx" ON "bitrix_crm_links" USING btree ("messenger","user_id");