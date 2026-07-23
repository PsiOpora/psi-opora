import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import { createUpstashRedis } from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
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
    const api = resolveBitrixApi(env.BITRIX_MEMBER_ID);
    if (!api) throw new Error("Bitrix24 не подключён");
    const redis = createUpstashRedis();
    return sendDiagnosticReminders(api, redis);
  },
});
