import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Логическая связка каналов одного и того же человека: если клиент написал,
 * например, и в Telegram, и в MAX, оператор мёржит вторую identity в первую
 * из инбокса «Клиенты». Физические строки bot_users/bot_messages/client_notes
 * не переносятся — id здесь ВСЕГДА вторичная (поглощённая) identity, primary
 * никогда сама не является чьей-то secondary (глубина цепочки ≤ 1), это
 * поддерживает mergeClientIdentities (packages/db/src/queries/client-identity-links.ts).
 */
export const clientIdentityLinks = pgTable(
	"client_identity_links",
	{
		id: text("id").primaryKey(),
		messenger: text("messenger").notNull(),
		userId: text("user_id").notNull(),
		primaryMessenger: text("primary_messenger").notNull(),
		primaryUserId: text("primary_user_id").notNull(),
		mergedByOperatorId: text("merged_by_operator_id"),
		mergedByOperatorName: text("merged_by_operator_name"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("client_identity_links_primary_idx").on(
			table.primaryMessenger,
			table.primaryUserId,
		),
	],
);
