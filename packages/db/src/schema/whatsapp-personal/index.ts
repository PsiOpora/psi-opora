import { index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * Личные (номерные) аккаунты WhatsApp, подключённые как отдельный коннектор
 * Открытых линий Bitrix24 — аналог telegram_personal_accounts, но сессию
 * здесь держит контейнер WAHA (см. packages/waha), а не наш процесс: в БД
 * хранится только имя WAHA-сессии (waSessionName), сами данные авторизации
 * живут в сторадже WAHA (docker-том).
 *
 * Одна запись — один номер. Портал может подключить несколько номеров
 * на одну и ту же открытую линию — каждый регистрируется как отдельный
 * коннектор Открытых линий (imconnector.register/activate допускают любое
 * число разных CONNECTOR, активированных на одной LINE одновременно) —
 * поэтому уникальность строки — по тройке (портал, линия, коннектор), а
 * не только (портал, линия).
 */
export const whatsappPersonalAccounts = pgTable(
	"whatsapp_personal_accounts",
	{
		id: text("id").primaryKey(),
		memberId: text("member_id").notNull(),
		openLineId: text("open_line_id").notNull(),
		connectorId: text("connector_id").notNull(),
		phone: text("phone").notNull(),
		/** Имя сессии в WAHA (waSessionName) — по нему вебхук входящих
		 * (apps/bitrix-webhook/api/waha-webhook) находит портал и линию. */
		sessionName: text("session_name").notNull(),
		/** "connected" | "limited" | "error" — см. WhatsappPersonalAccountStatus в
		 * queries/whatsapp-personal.ts. Промежуточные шаги логина (pairing code
		 * ещё не введён на телефоне) сюда не попадают — состояние логина живёт
		 * в самой WAHA-сессии, строка появляется только при статусе WORKING. */
		status: text("status").notNull().default("connected"),
		lastError: text("last_error"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [
		unique("whatsapp_personal_accounts_member_line_idx").on(
			table.memberId,
			table.openLineId,
			table.connectorId,
		),
		unique("whatsapp_personal_accounts_session_idx").on(table.sessionName),
		index("whatsapp_personal_accounts_member_idx").on(table.memberId),
	],
);
