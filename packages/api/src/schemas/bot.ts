import { z } from "zod";

/** Произвольная карта key -> текст сценария бота (ключи из SCENARIO_TEXT_DEFS). */
export const saveBotTextsSchema = z.record(z.string(), z.string());

export type SaveBotTextsInput = z.infer<typeof saveBotTextsSchema>;

export const guideIdSchema = z.object({ id: z.string() });

/** Отправка выбранного гайда на адрес для проверки письма и вложения. */
export const sendTestGuideSchema = z.object({
  id: z.string(),
  email: z.email("Укажите корректный email"),
});

export type SendTestGuideInput = z.infer<typeof sendTestGuideSchema>;
