import { CreateTaskWorkflow } from "@hatchet-dev/typescript-sdk/v1";
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
	// Сдвиг от */10 — чтобы не стартовать в ту же минуту, что consultation-reminders
	// и другие крон-задачи, дёргающие Bitrix REST (лимит ~2 запроса/сек).
	on: { cron: "1-59/10 * * * *" },
	retries: 0,
	executionTimeout: "5m",
	fn: async () => {
		const api = resolveBitrixApi(env.BITRIX_MEMBER_ID);
		if (!api) throw new Error("Bitrix24 не подключён");
		const redis = createRedisClient();
		return { ...(await sendDiagnosticReminders(api, redis)) };
	},
});
