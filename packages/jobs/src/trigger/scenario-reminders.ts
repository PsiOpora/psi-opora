import {
  type ConsultationSession,
  createRedisStorage,
  createUpstashRedis,
  type ReminderRunResult,
  runScenarioReminders,
  type ScenarioMessage,
} from "@psi-opora/bot-core";
import { schedules } from "@trigger.dev/sdk";
import { type Messenger, sendMessengerMessage } from "../messenger";

function toButtons(message: ScenarioMessage) {
  return message.buttons?.map((row) =>
    row.map((button) => ({ text: button.label, payload: button.action })),
  );
}

/**
 * Напоминания сценария бота: пользователям, замолчавшим на полпути,
 * один раз повторяем вопрос; молчащим и после напоминания тихо
 * завершаем сценарий. Логика — runScenarioReminders в @psi-opora/bot-core.
 *
 * Живёт в trigger.dev, а не в Vercel cron: на Hobby-тарифе Vercel
 * лимит по кронам (2 шт., только раз в день).
 */
export const scenarioReminders = schedules.task({
  id: "scenario-reminders",
  cron: "*/15 * * * *",
  run: async () => {
    const redis = createUpstashRedis();
    const storage = createRedisStorage<ConsultationSession>(redis);

    const results: Partial<Record<Messenger, ReminderRunResult>> = {};
    for (const messenger of ["telegram", "max"] as const) {
      results[messenger] = await runScenarioReminders({
        redis,
        messenger,
        storage,
        send: (sessionKey, message) =>
          sendMessengerMessage(
            messenger,
            sessionKey,
            message.text,
            toButtons(message),
          ),
      });
    }

    return results;
  },
});
