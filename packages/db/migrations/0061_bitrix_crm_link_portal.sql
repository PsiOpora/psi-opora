-- Existing rows have no provable portal: retain NULL until a verified writer refreshes them.
ALTER TABLE "bitrix_crm_links" ADD COLUMN "portal_key" text;--> statement-breakpoint
CREATE INDEX "bitrix_crm_links_portal_contact_idx" ON "bitrix_crm_links" USING btree ("portal_key","contact_id");