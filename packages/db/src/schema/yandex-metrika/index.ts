import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

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
