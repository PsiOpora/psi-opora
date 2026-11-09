import type { BitrixApi } from "@psi-opora/bitrix-client";
import type { RedisClient } from "@psi-opora/bot-core";
import {
	type DiagnosticDealUpdateResult,
	handleDiagnosticDealUpdate,
} from "./diagnostic-scheduling";

/** Через сколько секунд повторить проверку, если сделку держит другой обработчик. */
export const RECHECK_LOCKED_RETRY_SECONDS = 5;
/**
 * Сколько раз подряд повторяем при занятой блокировке (≈ минута). После этого
 * обрабатываем сделку без блокировки — иначе новые события могли бы занимать
 * её бесконечно и сообщение клиенту не ушло бы никогда.
 */
export const RECHECK_MAX_LOCKED_ATTEMPTS = 12;

export type ScheduleRecheck = (
	dealId: number,
	delaySeconds: number,
	attempt: number,
) => Promise<void>;

/**
 * Одна отложенная проверка сделки диагностики (тело Hatchet-задачи
 * diagnostic-deal-recheck — отдельно от SDK, чтобы тестировать без него).
 */
export async function runDiagnosticRecheck(params: {
	api: BitrixApi;
	redis: RedisClient;
	dealId: number;
	/** Сколько раз проверка уже упёрлась в занятую блокировку. */
	attempt?: number;
	schedule: ScheduleRecheck;
}): Promise<DiagnosticDealUpdateResult> {
	const { api, redis, dealId, schedule } = params;
	const attempt = params.attempt ?? 0;
	const exhausted = attempt >= RECHECK_MAX_LOCKED_ATTEMPTS;
	if (exhausted) {
		console.warn(
			`[diagnostic-recheck] сделка ${dealId}: блокировка занята ${attempt} попыток подряд — обрабатываем без неё`,
		);
	}

	const result = await handleDiagnosticDealUpdate(api, redis, dealId, {
		// Если MOVED_TIME ещё в пределах минуты (расхождение часов) —
		// обработчик сам поставит следующий перезапуск, счётчик попыток с нуля.
		scheduleRecheck: (id, seconds) => schedule(id, seconds, 0),
		skipLock: exhausted,
	});

	if (result.reason === "locked") {
		// Сделку обрабатывает другое событие и, скорее всего, уже отложило
		// отправку (его перезапуск мы же и есть) — само оно не отправит.
		await schedule(dealId, RECHECK_LOCKED_RETRY_SECONDS, attempt + 1);
	}
	return result;
}
