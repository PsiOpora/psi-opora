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
