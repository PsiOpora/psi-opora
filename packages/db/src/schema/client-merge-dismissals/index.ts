import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Пары клиентов, которых оператор пометил «это разные люди» — подсказка
 * «возможный дубль» (см. packages/api/src/routers/messages/merge-suggestions.ts)
 * для них больше не показывается. Ключи — канонические identity вида
 * `messenger:userId` на момент решения, пара хранится в отсортированном виде,
 * чтобы не зависеть от того, с какой стороны оператор нажал кнопку.
 */
export const clientMergeDismissals = pgTable(
	"client_merge_dismissals",
	{
		id: text("id").primaryKey(),
		keyA: text("key_a").notNull(),
		keyB: text("key_b").notNull(),
		dismissedByOperatorId: text("dismissed_by_operator_id"),
		dismissedByOperatorName: text("dismissed_by_operator_name"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("client_merge_dismissals_key_a_idx").on(table.keyA),
		index("client_merge_dismissals_key_b_idx").on(table.keyB),
	],
);
