ALTER TABLE "telegram_personal_accounts" DROP CONSTRAINT "telegram_personal_accounts_member_line_idx";--> statement-breakpoint
ALTER TABLE "whatsapp_personal_accounts" DROP CONSTRAINT "whatsapp_personal_accounts_member_line_idx";--> statement-breakpoint
ALTER TABLE "telegram_personal_accounts" ADD CONSTRAINT "telegram_personal_accounts_member_line_idx" UNIQUE("member_id","open_line_id","connector_id");--> statement-breakpoint
ALTER TABLE "whatsapp_personal_accounts" ADD CONSTRAINT "whatsapp_personal_accounts_member_line_idx" UNIQUE("member_id","open_line_id","connector_id");