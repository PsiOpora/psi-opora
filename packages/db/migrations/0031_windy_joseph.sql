ALTER TABLE "email_templates" ADD COLUMN "template_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN "fields" jsonb DEFAULT '{}'::jsonb NOT NULL;