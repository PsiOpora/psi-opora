import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Библиотека PDF-гайдов (лид-магнитов), загружаемых в дашборде.
 * Какой из них сейчас активен (его бот шлёт в сценарии) — записано
 * в bot_texts под ключами GUIDE_FILE_* (см. @psi-opora/bot-core).
 */
export const botGuides = pgTable("bot_guides", {
	id: text("id").primaryKey(),
	title: text("title").notNull(),
	fileName: text("file_name").notNull(),
	fileUrl: text("file_url").notNull(),
	s3Key: text("s3_key").notNull(),
	fileSize: integer("file_size").notNull(),
	createdAt: timestamp("created_at").defaultNow(),
});
