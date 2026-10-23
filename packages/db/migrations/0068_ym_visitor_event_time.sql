ALTER TABLE "yandex_metrika_messenger_visitors" ADD COLUMN "visited_at" timestamp;
--> statement-breakpoint
-- Legacy rows have no separate event time; preserve their previous ordering.
UPDATE "yandex_metrika_messenger_visitors" SET "visited_at" = "updated_at";
--> statement-breakpoint
ALTER TABLE "yandex_metrika_messenger_visitors" ALTER COLUMN "visited_at" SET NOT NULL;
