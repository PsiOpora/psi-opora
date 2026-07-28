import { CreateTaskWorkflow } from "@hatchet-dev/typescript-sdk";
import {
  type ConsultationSession,
  createRedisClient,
  createRedisStorage,
  type ReminderRunResult,
  runScenarioReminders,
  type ScenarioMessage,
} from "@psi-opora/bot-core";
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
 * Живёт в Hatchet, а не в Vercel cron: на Hobby-тарифе Vercel
 * лимит по кронам (2 шт., только раз в день).
 */
export const scenarioReminders = CreateTaskWorkflow({
  name: "scenario-reminders",
  on: { cron: "*/15 * * * *" },
  retries: 0,
  executionTimeout: "10m",
  fn: async () => {
    const redis = createRedisClient();
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
