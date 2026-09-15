CREATE TABLE "bot_guides" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"s3_key" text NOT NULL,
	"file_size" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);
