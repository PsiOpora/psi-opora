import { sql } from "drizzle-orm";
import { db } from "../client";

/**
 * Точечное применение аддитивных изменений схемы для инбокса «Клиенты»
 * (apps/clients): заметки, быстрые ответы, теги диалогов. Обходной путь
 * вместо `drizzle-kit push` — тот упирается в несвязанный дрейф схемы
 * telegram_personal_accounts и предлагает truncate живой таблицы.
 * Скрипт идемпотентен (IF NOT EXISTS) — можно запускать повторно.
 */
async function apply() {
  if (!db) {
    console.error("Нет подключения к БД (POSTGRES_URL)");
    process.exit(1);
  }

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "client_notes" (
      "id" text PRIMARY KEY NOT NULL,
      "messenger" text NOT NULL,
      "user_id" text NOT NULL,
      "text" text NOT NULL,
      "operator_id" text,
      "operator_name" text,
      "created_at" timestamp DEFAULT now() NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "client_notes_dialog_idx"
      ON "client_notes" ("messenger", "user_id", "created_at")
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "quick_replies" (
      "id" text PRIMARY KEY NOT NULL,
      "title" text NOT NULL,
      "text" text NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    )
  `);
  await db.execute(sql`
    ALTER TABLE "bot_conversations" ADD COLUMN IF NOT EXISTS "tags" jsonb
  `);

  console.log(
    "✅ client_notes, quick_replies и bot_conversations.tags применены",
  );
  process.exit(0);
}

apply().catch((err) => {
  console.error("❌", err);
  process.exit(1);
});
