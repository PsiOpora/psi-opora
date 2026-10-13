import { CreateTaskWorkflow } from "@hatchet-dev/typescript-sdk/v1";
import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import { createRedisClient } from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import { sendConsultationReminders } from "../consultation-reminders";
import { sendDiagnosticReminders } from "../diagnostic-reminders";
import { runSteps } from "./run-steps";

/**
 * Напоминания о консультации и о диагностической консультации за час до
 * встречи. Состояние сделок наполняется вебхуком ONCRMDEALUPDATE
 * (apps/bitrix-webhook), здесь только рассылка. См. sendConsultationReminders
 * в consultation-reminders.ts и sendDiagnosticReminders в
 * diagnostic-reminders.ts.
 *
 * Один крон на оба вида напоминаний — из-за лимита Hatchet на число
 * cron-триггеров; шаги идут последовательно, так что лимит Bitrix REST
 * (~2 запроса/сек) не превышается.
 */
export const calendarReminders = CreateTaskWorkflow({
	name: "calendar-reminders",
	// Сдвиг от */10 — чтобы не стартовать в ту же минуту, что другие крон-задачи,
	// дёргающие Bitrix REST (лимит ~2 запроса/сек).
	on: { cron: "1-59/10 * * * *" },
	retries: 0,
	executionTimeout: "10m",
	fn: async () => {
		const api = resolveBitrixApi(env.BITRIX_MEMBER_ID);
		if (!api) throw new Error("Bitrix24 не подключён");
		const redis = createRedisClient();
		return await runSteps({
			consultation: async () => ({
				...(await sendConsultationReminders(api, redis)),
			}),
			diagnostic: async () => ({
				...(await sendDiagnosticReminders(api, redis)),
			}),
		});
	},
});
