import { CreateTaskWorkflow } from "@hatchet-dev/typescript-sdk/v1";
import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import { createRedisClient } from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import { runDiagnosticRecheck } from "../diagnostic-recheck-run";
import { getHatchetClient } from "./client";

export type DiagnosticRecheckPayload = {
	dealId: number;
	/** Сколько раз проверка уже упёрлась в занятую блокировку сделки. */
	attempt?: number;
};

const WORKFLOW_NAME = "diagnostic-deal-recheck";

/**
 * Ставит отложенную повторную обработку сделки диагностики (см.
 * PAYMENT_MESSAGE_GRACE_MS в diagnostic-scheduling.ts). Через Hatchet, а не
 * setTimeout: перезапуск пода за эту минуту не должен терять сообщение клиенту.
 */
export async function scheduleDiagnosticRecheck(
	dealId: number,
	delaySeconds: number,
	attempt = 0,
): Promise<void> {
	await getHatchetClient().schedules.create(WORKFLOW_NAME, {
		triggerAt: new Date(Date.now() + delaySeconds * 1000),
		input: { dealId, attempt },
	});
}

/**
 * Повторно прогоняет обработчик сделки диагностики после грейс-периода. Он
 * заново читает сделку из Bitrix24: если стадию успели сменить — отправки не
 * будет; если сделка всё ещё на «ждем оплату» — клиенту уходит сообщение.
 */
export const diagnosticDealRecheck = CreateTaskWorkflow({
	name: WORKFLOW_NAME,
	retries: 0,
	executionTimeout: "5m",
	scheduleTimeout: "1h",
	fn: async (payload: DiagnosticRecheckPayload) => {
		const api = resolveBitrixApi(env.BITRIX_MEMBER_ID);
		if (!api) throw new Error("Bitrix24 не подключён");
		const result = await runDiagnosticRecheck({
			api,
			redis: createRedisClient(),
			dealId: payload.dealId,
			attempt: payload.attempt,
			schedule: scheduleDiagnosticRecheck,
		});
		console.info(
			`[diagnostic-recheck] сделка ${payload.dealId}: ${result.action}, чат: ${result.chat}${result.chatReason ? ` (${result.chatReason})` : ""}, email: ${result.email}`,
		);
	},
});
