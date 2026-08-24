ALTER TABLE "deals" ADD COLUMN "fail_reason_id" text;--> statement-breakpoint
CREATE INDEX "deals_fail_reason_idx" ON "deals" USING btree ("fail_reason_id");