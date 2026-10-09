import {
	boolean,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";

/**
 * Настройки офлайн-конверсии «Запись на консультацию» в Яндекс.Метрику —
 * вводятся администратором в дашборде (/settings/metrika), а не через
 * .env, чтобы это можно было настроить/поменять без деплоя. Singleton-строка
 * (id всегда "singleton"), как ad_credentials.
 */
export const yandexMetrikaSettings = pgTable("yandex_metrika_settings", {
	id: text("id").primaryKey().default("singleton"),
	counterId: text("counter_id"),
	oauthToken: text("oauth_token"),
	// Идентификатор цели (Target в CSV офлайн-конверсий) — цель типа
	// «JavaScript-событие» с условием «содержит», создаётся в Метрике заранее.
	goalId: text("goal_id").default("free_consultation_booked"),
	// Код пользовательского поля сделки в Bitrix (CRM → Настройки →
	// Пользовательские поля → Сделка) для ClientID — необязательно.
	bitrixClientIdField: text("bitrix_client_id_field"),
	updatedAt: timestamp("updated_at").defaultNow(),
});

/**
 * Цели Метрики, привязанные владельцем портала к стадии воронки Bitrix
 * (/settings/metrika). Когда сделка попадает в `stageId`, в Метрику уходит
 * офлайн-конверсия `goalId` по ClientID/yclid сделки (см.
 * packages/jobs/src/yandex-metrika-stage-goals.ts). Счётчик и OAuth-токен
 * общие — из yandex_metrika_settings.
 */
export const yandexMetrikaStageGoals = pgTable(
	"yandex_metrika_stage_goals",
	{
		id: text("id").primaryKey(),
		// Подпись для списка в дашборде.
		name: text("name").notNull(),
		// Идентификатор цели в Метрике (Target в CSV) — цель «JavaScript-событие».
		goalId: text("goal_id").notNull(),
		// CATEGORY_ID воронки Bitrix; хранится рядом со stageId для подписи и
		// защиты от сделки той же стадии из другой воронки.
		categoryId: text("category_id").notNull(),
		stageId: text("stage_id").notNull(),
		enabled: boolean("enabled").notNull().default(true),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [
		unique("yandex_metrika_stage_goals_stage_goal_uq").on(
			table.stageId,
			table.goalId,
		),
	],
);

/**
 * Идентификаторы визита (ClientID Метрики, yclid), с которыми бот создал
 * сделку. Нужны для конверсий по смене стадии: к этому моменту сессии бота
 * уже нет, а сама сделка в Bitrix хранит ClientID только в необязательном
 * пользовательском поле.
 */
export const yandexMetrikaDealVisitors = pgTable(
	"yandex_metrika_deal_visitors",
	{
		dealId: text("deal_id").primaryKey(), // ID сделки в Bitrix24, как есть
		clientId: text("client_id"),
		yclid: text("yclid"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
);

/**
 * Журнал отправок по стадиям — одна запись на пару «цель + сделка».
 * Pending-запись резервируется на время отправки; sent не отправляется снова.
 * Токен защищает новый резерв от завершения устаревшим обработчиком.
 */
export const yandexMetrikaGoalEvents = pgTable(
	"yandex_metrika_goal_events",
	{
		stageGoalId: text("stage_goal_id")
			.notNull()
			.references(() => yandexMetrikaStageGoals.id, { onDelete: "cascade" }),
		dealId: text("deal_id").notNull(),
		status: text("status", { enum: ["pending", "sent"] })
			.notNull()
			.default("pending"),
		claimedAt: timestamp("claimed_at").defaultNow().notNull(),
		claimToken: text("claim_token"),
		sentAt: timestamp("sent_at"),
	},
	(table) => [primaryKey({ columns: [table.stageGoalId, table.dealId] })],
);
