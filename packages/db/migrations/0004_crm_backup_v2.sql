ALTER TABLE "backup_runs" ADD COLUMN IF NOT EXISTS "manifest_key" text;
ALTER TABLE "backup_runs" ADD COLUMN IF NOT EXISTS "prefix" text;
ALTER TABLE "backup_runs" ADD COLUMN IF NOT EXISTS "total_bytes" integer;
ALTER TABLE "backup_runs" ADD COLUMN IF NOT EXISTS "errors" jsonb;
ALTER TABLE "backup_runs" DROP COLUMN IF EXISTS "size_bytes";
