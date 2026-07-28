import { CreateTaskWorkflow } from "@hatchet-dev/typescript-sdk";
import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import { createRedisClient } from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import { sendDiagnosticReminders } from "../diagnostic-reminders";

/**
 * Напоминания о диагностической консультации за час до встречи.
 * См. sendDiagnosticReminders в diagnostic-reminders.ts.
 */
export const diagnosticReminders = CreateTaskWorkflow({
  name: "diagnostic-reminders",
  on: { cron: "*/5 * * * *" },
  retries: 0,
  executionTimeout: "5m",
  fn: async () => {
    const api = resolveBitrixApi(env.BITRIX_MEMBER_ID);
    if (!api) throw new Error("Bitrix24 не подключён");
    const redis = createRedisClient();
    return sendDiagnosticReminders(api, redis);
  },
});
