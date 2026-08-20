import { index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * Личные (номерные) аккаунты Telegram, подключённые как отдельный коннектор
 * Открытых линий Bitrix24 (packages/tg-userbot, mtcute) — в отличие от
 * apps/tg-bot (официальный Bot API), это реальный номер телефона, из-под
 * которого можно писать клиенту первым.
 *
 * Одна запись — один номер. Портал может подключить несколько номеров
 * на одну и ту же открытую линию — каждый регистрируется как отдельный
 * коннектор Открытых линий (imconnector.register/activate допускают любое
 * число разных CONNECTOR, активированных на одной LINE одновременно) —
 * поэтому уникальность строки — по тройке (портал, линия, коннектор), а
 * не только (портал, линия).
 */
export const telegramPersonalAccounts = pgTable(
	"telegram_personal_accounts",
	{
		id: text("id").primaryKey(),
		memberId: text("member_id").notNull(),
		openLineId: text("open_line_id").notNull(),
		connectorId: text("connector_id").notNull(),
		phone: text("phone").notNull(),
		/** api_id/api_hash приложения Telegram (my.telegram.org/apps) — вводит
		 * администратор при подключении номера, а не берётся из env: у каждого
		 * подключаемого номера может быть своё приложение. api_hash хранится
		 * зашифрованным, как и сессия (packages/tg-userbot/src/crypto.ts). */
		apiId: text("api_id").notNull(),
		apiHashEncrypted: text("api_hash_encrypted").notNull(),
		/** MTProto-сессия, зашифрованная AES-256-GCM (packages/tg-userbot/src/crypto.ts). */
		sessionEncrypted: text("session_encrypted"),
		/** "connected" | "error" — см. TelegramPersonalAccountStatus в queries/telegram-personal.ts.
		 * Промежуточные шаги логина (код/пароль не подтверждены) в эту таблицу
		 * не попадают — это состояние живёт только в Redis, строка здесь
		 * появляется только при успешном подключении. */
		status: text("status").notNull().default("connected"),
		lastError: text("last_error"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [
		unique("telegram_personal_accounts_member_line_idx").on(
			table.memberId,
			table.openLineId,
			table.connectorId,
		),
		index("telegram_personal_accounts_member_idx").on(table.memberId),
	],
);
