ALTER TABLE "deals" ADD COLUMN "contact_id" text;--> statement-breakpoint
CREATE INDEX "deals_contact_id_date_create_idx" ON "deals" USING btree ("contact_id","date_create");