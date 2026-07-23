import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import { createUpstashRedis } from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import { schedules } from "@trigger.dev/sdk";
import { sendConsultationReminders } from "../consultation-reminders";

/**
 * Напоминания о консультации за час: состояние сделок наполняется
 * вебхуком ONCRMDEALUPDATE (apps/bitrix-webhook), здесь только рассылка.
 * См. sendConsultationReminders в consultation-reminders.ts.
 */
export const consultationReminders = schedules.task({
  id: "consultation-reminders",
  cron: "*/5 * * * *",
  run: async () => {
    const api = resolveBitrixApi(env.BITRIX_MEMBER_ID);
    if (!api) throw new Error("Bitrix24 не подключён");
    const redis = createUpstashRedis();
    return sendConsultationReminders(api, redis);
  },
});
