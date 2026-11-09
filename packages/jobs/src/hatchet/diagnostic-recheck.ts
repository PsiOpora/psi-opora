import { CreateTaskWorkflow } from "@hatchet-dev/typescript-sdk/v1";
import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import { createRedisClient } from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import { handleDiagnosticDealUpdate } from "../diagnostic-scheduling";
import { getHatchetClient } from "./client";

export type DiagnosticRecheckPayload = {
	dealId: number;
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
): Promise<void> {
	await getHatchetClient().schedules.create(WORKFLOW_NAME, {
		triggerAt: new Date(Date.now() + delaySeconds * 1000),
		input: { dealId },
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
		const result = await handleDiagnosticDealUpdate(
			api,
			createRedisClient(),
			payload.dealId,
			// Если MOVED_TIME ещё в пределах минуты (расхождение часов) —
			// обработчик сам поставит следующий перезапуск.
			{ scheduleRecheck: scheduleDiagnosticRecheck },
		);
		console.info(
			`[diagnostic-recheck] сделка ${payload.dealId}: ${result.action}, чат: ${result.chat}${result.chatReason ? ` (${result.chatReason})` : ""}, email: ${result.email}`,
		);
	},
});
