import type { BitrixApi } from "@psi-opora/bitrix-client";
import type { RedisClient } from "@psi-opora/bot-core";
import {
	type DiagnosticDealUpdateOptions,
	type DiagnosticDealUpdateResult,
	handleDiagnosticDealUpdate,
	PENDING_DELIVERY_SET,
} from "./diagnostic-scheduling";

/**
 * Повторы при занятой блокировке сделки: сначала часто (блокировку держит
 * обработчик соседнего события, это секунды), потом реже. Блокировка не
 * обходится никогда — иначе два обработчика могли бы отправить сообщение
 * дважды.
 */
export const RECHECK_FAST_RETRIES = 12;
export const RECHECK_FAST_RETRY_SECONDS = 5;
export const RECHECK_SLOW_RETRY_SECONDS = 30;
/** Всего повторов ≈ 6 минут; дальше задача падает с ошибкой, а сделку добирает крон. */
export const RECHECK_MAX_LOCKED_ATTEMPTS = 22;

export type ScheduleRecheck = (
	dealId: number,
	delaySeconds: number,
	attempt: number,
) => Promise<void>;

function retryDelaySeconds(nextAttempt: number): number {
	return nextAttempt <= RECHECK_FAST_RETRIES
		? RECHECK_FAST_RETRY_SECONDS
		: RECHECK_SLOW_RETRY_SECONDS;
}

/**
 * Одна отложенная проверка сделки диагностики (тело Hatchet-задачи
 * diagnostic-deal-recheck — отдельно от SDK, чтобы тестировать без него).
 *
 * Если блокировка занята дольше всех повторов, задача завершается ошибкой:
 * это видно в телеметрии (console.error) и в Hatchet. Сообщение при этом не
 * потеряно: сделка остаётся в PENDING_DELIVERY_SET, и её добирает крон
 * (sweepPendingDiagnosticDeals) — независимо от новых событий по сделке.
 */
export async function runDiagnosticRecheck(params: {
	api: BitrixApi;
	redis: RedisClient;
	dealId: number;
	/** Сколько раз проверка уже упёрлась в занятую блокировку. */
	attempt?: number;
	schedule: ScheduleRecheck;
	/** Прокидывается в обработчик сделки — для тестов. */
	handlerOptions?: Pick<DiagnosticDealUpdateOptions, "sendBot" | "now">;
}): Promise<DiagnosticDealUpdateResult> {
	const { api, redis, dealId, schedule } = params;
	const attempt = params.attempt ?? 0;

	const result = await handleDiagnosticDealUpdate(api, redis, dealId, {
		...params.handlerOptions,
		// Если MOVED_TIME ещё в пределах минуты (расхождение часов) —
		// обработчик сам поставит следующий перезапуск, счётчик попыток с нуля.
		scheduleRecheck: (id, seconds) => schedule(id, seconds, 0),
	});

	if (result.reason === "locked") {
		// Сделку обрабатывает другое событие и, скорее всего, уже отложило
		// отправку (его перезапуск мы же и есть) — само оно не отправит.
		const nextAttempt = attempt + 1;
		if (nextAttempt >= RECHECK_MAX_LOCKED_ATTEMPTS) {
			const message = `[diagnostic-recheck] сделка ${dealId}: блокировка занята ${nextAttempt} попыток подряд, сообщение клиенту пока не отправлено — его доберёт крон`;
			console.error(message);
			throw new Error(message);
		}
		await schedule(dealId, retryDelaySeconds(nextAttempt), nextAttempt);
	}
	return result;
}

export interface SweepPendingDiagnosticDealsResult {
	checked: number;
	/** Сделки, которые больше не ждут отправки (отправлено / стадию сменили). */
	resolved: number;
	/** Всё ещё ждут: блокировка занята или идёт минута ожидания. */
	stillPending: number;
	errors: number;
}

/**
 * Страховка отложенной отправки: обрабатывает сделки из PENDING_DELIVERY_SET
 * тем же обработчиком, что и событие Bitrix24 — не зависит ни от новых событий,
 * ни от того, что запуск Hatchet потерялся или упёрся в блокировку. Вызывается
 * кроном calendar-reminders раз в 10 минут. Запись удаляется, только когда
 * сделка перестала ждать отправки; при ошибке остаётся до следующего прогона.
 */
export async function sweepPendingDiagnosticDeals(
	api: BitrixApi,
	redis: RedisClient,
	options: DiagnosticDealUpdateOptions = {},
): Promise<SweepPendingDiagnosticDealsResult> {
	const members = await redis.smembers<string | number>(PENDING_DELIVERY_SET);
	const summary: SweepPendingDiagnosticDealsResult = {
		checked: 0,
		resolved: 0,
		stillPending: 0,
		errors: 0,
	};
	for (const member of members) {
		const dealId = Number(member);
		if (!Number.isInteger(dealId) || dealId <= 0) {
			await redis.srem(PENDING_DELIVERY_SET, member);
			continue;
		}
		summary.checked++;
		try {
			const result = await handleDiagnosticDealUpdate(
				api,
				redis,
				dealId,
				options,
			);
			if (result.reason === "locked" || result.chatReason === "grace_period") {
				summary.stillPending++;
				continue;
			}
			await redis.srem(PENDING_DELIVERY_SET, String(member));
			summary.resolved++;
		} catch (error) {
			summary.errors++;
			console.error(
				`[diagnostic-recheck] добор сделки ${dealId} не удался: ${(error as Error).message}`,
			);
		}
	}
	return summary;
}
