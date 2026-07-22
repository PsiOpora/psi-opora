import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import { createUpstashRedis } from "@psi-opora/bot-core";
import { schedules } from "@trigger.dev/sdk";
import { sendDiagnosticReminders } from "../diagnostic-reminders";

/**
 * Напоминания о диагностической консультации за час до встречи.
 * См. sendDiagnosticReminders в diagnostic-reminders.ts.
 */
export const diagnosticReminders = schedules.task({
  id: "diagnostic-reminders",
  cron: "*/5 * * * *",
  run: async () => {
    const api = resolveBitrixApi();
    if (!api) throw new Error("Bitrix24 не подключён");
    const redis = createUpstashRedis();
    return sendDiagnosticReminders(api, redis);
  },
});
