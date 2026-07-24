import { sql } from "drizzle-orm";
import { db } from "../client";

/**
 * Точечное применение аддитивных изменений схемы bot_messages для поддержки
 * голосовых/аудио-вложений (Telegram voice/audio, MAX audio-attachment, WAHA
 * аудио). Обходной путь вместо `drizzle-kit push` — см. apply-clients-inbox-schema.ts.
 * Скрипт идемпотентен (IF NOT EXISTS) — можно запускать повторно.
 */
async function apply() {
  if (!db) {
    console.error("Нет подключения к БД (POSTGRES_URL)");
    process.exit(1);
  }

  await db.execute(sql`
    ALTER TABLE "bot_messages" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'text'
  `);
  await db.execute(sql`
    ALTER TABLE "bot_messages" ADD COLUMN IF NOT EXISTS "media_s3_key" text
  `);
  await db.execute(sql`
    ALTER TABLE "bot_messages" ADD COLUMN IF NOT EXISTS "media_mime_type" text
  `);
  await db.execute(sql`
    ALTER TABLE "bot_messages" ADD COLUMN IF NOT EXISTS "media_duration_sec" integer
  `);

  console.log("✅ bot_messages.kind/media_* применены");
  process.exit(0);
}

apply().catch((err) => {
  console.error("❌", err);
  process.exit(1);
});
