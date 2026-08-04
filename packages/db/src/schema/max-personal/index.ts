import { index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

/** Личные аккаунты MAX, подключённые как отдельные коннекторы Открытых линий. */
export const maxPersonalAccounts = pgTable(
	"max_personal_accounts",
	{
		id: text("id").primaryKey(),
		memberId: text("member_id").notNull(),
		openLineId: text("open_line_id").notNull(),
		connectorId: text("connector_id").notNull(),
		phone: text("phone").notNull(),
		/** Токен и deviceId reverse-engineered протокола, AES-256-GCM. */
		sessionEncrypted: text("session_encrypted").notNull(),
		status: text("status").notNull().default("connected"),
		lastError: text("last_error"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [
		unique("max_personal_accounts_member_line_idx").on(
			table.memberId,
			table.openLineId,
			table.connectorId,
		),
		index("max_personal_accounts_member_idx").on(table.memberId),
	],
);
