ALTER TABLE "backup_runs" ADD COLUMN IF NOT EXISTS "entities_total" integer;
ALTER TABLE "backup_runs" ADD COLUMN IF NOT EXISTS "entities_done" integer;
ALTER TABLE "backup_runs" ADD COLUMN IF NOT EXISTS "current_entity" text;
