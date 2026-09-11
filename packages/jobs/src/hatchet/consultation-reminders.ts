import { CreateTaskWorkflow } from "@hatchet-dev/typescript-sdk/v1";
import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import { createRedisClient } from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import { sendConsultationReminders } from "../consultation-reminders";

/**
 * Напоминания о консультации за час: состояние сделок наполняется
 * вебхуком ONCRMDEALUPDATE (apps/bitrix-webhook), здесь только рассылка.
 * См. sendConsultationReminders в consultation-reminders.ts.
 */
export const consultationReminders = CreateTaskWorkflow({
	name: "consultation-reminders",
	// Сдвиг от */10 — чтобы не стартовать в ту же минуту, что diagnostic-reminders
	// и другие крон-задачи, дёргающие Bitrix REST (лимит ~2 запроса/сек).
	on: { cron: "3-59/10 * * * *" },
	retries: 0,
	executionTimeout: "5m",
	fn: async () => {
		const api = resolveBitrixApi(env.BITRIX_MEMBER_ID);
		if (!api) throw new Error("Bitrix24 не подключён");
		const redis = createRedisClient();
		return { ...(await sendConsultationReminders(api, redis)) };
	},
});
