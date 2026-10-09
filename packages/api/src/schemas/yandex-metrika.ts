import { z } from "zod";

/**
 * Схема настроек офлайн-конверсии в Яндекс.Метрику (счётчик, OAuth-токен,
 * идентификатор цели, поле ClientID в Bitrix) — вводится администратором в
 * дашборде (/settings/metrika), см. packages/bot-core/src/utils/yandex-metrika.ts.
 *
 * Используется и на сервере (input процедуры `yandexMetrika.upsertSettings`),
 * и на клиенте (resolver формы настроек) — единый источник валидации.
 */
export const yandexMetrikaSettingsSchema = z.object({
	counterId: z.string().trim().optional(),
	oauthToken: z.string().trim().optional(),
	goalId: z.string().trim().optional(),
	bitrixClientIdField: z.string().trim().optional(),
});

export type YandexMetrikaSettingsInput = z.infer<
	typeof yandexMetrikaSettingsSchema
>;

/**
 * Цель Метрики, привязанная к стадии воронки Bitrix (/settings/metrika) —
 * когда сделка попадает в стадию, бот отправляет в Метрику конверсию этой цели.
 * Воронка не передаётся отдельно: она однозначно определяется STAGE_ID
 * ("C5:NEW" → воронка 5, "NEW" → основная).
 */
export const yandexMetrikaStageGoalSchema = z.object({
	name: z.string().trim().min(1, "Укажите название").max(100),
	// Идентификатор уходит в CSV офлайн-конверсий без экранирования, поэтому
	// запятые, пробелы и переводы строк недопустимы.
	goalId: z
		.string()
		.trim()
		.min(1, "Укажите идентификатор цели")
		.max(200)
		.regex(
			/^[A-Za-z0-9_.:-]+$/,
			"Только латиница, цифры и символы _ . : -",
		),
	stageId: z.string().trim().min(1, "Выберите стадию").max(100),
	enabled: z.boolean(),
});

export const updateYandexMetrikaStageGoalSchema =
	yandexMetrikaStageGoalSchema.extend({ id: z.string().min(1) });

export const yandexMetrikaStageGoalIdSchema = z.object({
	id: z.string().min(1),
});

export type YandexMetrikaStageGoalInput = z.infer<
	typeof yandexMetrikaStageGoalSchema
>;
