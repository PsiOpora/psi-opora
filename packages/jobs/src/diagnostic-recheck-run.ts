import type { BitrixApi } from "@psi-opora/bitrix-client";
import type { RedisClient } from "@psi-opora/bot-core";
import {
	type DiagnosticDealUpdateOptions,
	type DiagnosticDealUpdateResult,
	handleDiagnosticDealUpdate,
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
/** Всего повторов ≈ 6 минут; дальше задача падает с ошибкой (см. ниже). */
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
 * потеряно навсегда — минута к этому моменту давно прошла, и первое же
 * следующее событие по сделке отправит его сразу.
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
			const message = `[diagnostic-recheck] сделка ${dealId}: блокировка занята ${nextAttempt} попыток подряд, сообщение клиенту не отправлено — уйдёт при следующем событии по сделке`;
			console.error(message);
			throw new Error(message);
		}
		await schedule(dealId, retryDelaySeconds(nextAttempt), nextAttempt);
	}
	return result;
}
