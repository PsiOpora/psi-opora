import { z } from "zod";

/** Произвольная карта key -> текст сценария бота (ключи из SCENARIO_TEXT_DEFS). */
export const saveBotTextsSchema = z.record(z.string(), z.string());

export type SaveBotTextsInput = z.infer<typeof saveBotTextsSchema>;

export const guideIdSchema = z.object({ id: z.string() });

/** Тестовая отправка на адрес того же письма, что реально уйдёт клиенту (активный гайд). */
export const sendTestGuideSchema = z.object({
  email: z.email("Укажите корректный email"),
});

export type SendTestGuideInput = z.infer<typeof sendTestGuideSchema>;

/**
 * Username ботов для ссылок-диплинков в дашборде. Хранятся в bot_texts
 * (TG_BOT_USERNAME_KEY / MAX_BOT_USERNAME_KEY), «@» отбрасывается при
 * сборке ссылки — заказчик обычно копирует username вместе с ним.
 */
export const saveBotUsernamesSchema = z.object({
  telegram: z.string().max(64).optional(),
  max: z.string().max(64).optional(),
});

export type SaveBotUsernamesInput = z.infer<typeof saveBotUsernamesSchema>;

/** Автоопределение username через Telegram getMe / MAX GET /me. */
export const detectBotUsernameSchema = z.object({
  messenger: z.enum(["telegram", "max"]),
});

export type DetectBotUsernameInput = z.infer<typeof detectBotUsernameSchema>;
