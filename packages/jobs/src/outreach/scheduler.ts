/**
 * Ожидания внутри задачи рассылки: паузы между сообщениями, перерывы,
 * дневные лимиты и окно отправки. Короткие ожидания выдерживаются прямо в
 * запуске (с проверкой отмены), а те, что не укладываются в бюджет запуска
 * (ночь, выходные, следующие сутки), задача передаёт отложенному запуску.
 */

import type { CascadeAttempt, GateDecision, MessengerChannel } from "./cascade";
import {
	type ChannelPacer,
	describePause,
	nextWindowOpening,
	type OutreachPlan,
} from "./pacing";

/** Как часто во время ожидания проверяем отмену рассылки. */
const CANCEL_POLL_MS = 15_000;
/** Ожидания дольше этого показываем в отчёте как паузу рассылки. */
const VISIBLE_PAUSE_MS = 60_000;

export type WaitResult =
	| { kind: "ok" }
	| { kind: "cancelled" }
	/** Ожидание не умещается в запуск — продолжить отложенным запуском в until. */
	| { kind: "handoff"; until: Date; reason: string };

export interface WaiterDeps {
	/** До какого момента запуску можно работать. */
	runEnd: number;
	isCancelled: () => Promise<boolean>;
	setPause: (pause: { resumeAt: Date; reason: string } | null) => Promise<void>;
	sleep: (ms: number) => Promise<void>;
	now?: () => number;
}

export function createWaiter(deps: WaiterDeps) {
	const now = deps.now ?? Date.now;
	return async function waitUntil(
		until: Date,
		reason: string,
	): Promise<WaitResult> {
		const target = until.getTime();
		if (target <= now()) return { kind: "ok" };
		if (target > deps.runEnd) return { kind: "handoff", until, reason };
		const visible = target - now() >= VISIBLE_PAUSE_MS;
		if (visible) await deps.setPause({ resumeAt: until, reason });
		try {
			while (now() < target) {
				await deps.sleep(Math.min(CANCEL_POLL_MS, target - now()));
				if (await deps.isCancelled()) return { kind: "cancelled" };
			}
		} finally {
			if (visible) await deps.setPause(null);
		}
		return { kind: "ok" };
	};
}

export type StopReason = Exclude<WaitResult, { kind: "ok" }>;

/**
 * Шлюз каскада: перед попыткой в канал ждёт окно отправки и паузу номера,
 * а при исчерпанном дневном лимите либо ждёт следующих суток, либо
 * пропускает канал (как задано в рассылке). Почему каскад остановлен —
 * в stopReason(), чтобы задача решила: отменять или передавать эстафету.
 */
export function createPacingGate(params: {
	plan: OutreachPlan;
	pacers: Map<MessengerChannel, ChannelPacer>;
	waitUntil: ReturnType<typeof createWaiter>;
	/** Перед отправкой — получатель «в процессе» (с уже сделанными попытками). */
	onSend: (attempts: CascadeAttempt[]) => Promise<void>;
	now?: () => Date;
}) {
	const now = params.now ?? (() => new Date());
	let stop: StopReason | null = null;

	async function gate(
		channel: MessengerChannel,
		attempts: CascadeAttempt[],
	): Promise<GateDecision> {
		const pacer = params.pacers.get(channel);
		if (!pacer) return { kind: "go" };
		for (;;) {
			let waited: WaitResult;
			const opening = nextWindowOpening(now(), params.plan.window);
			if (opening) {
				waited = await params.waitUntil(opening, "Вне окна отправки");
			} else {
				const state = pacer.state(now());
				if (state.kind === "ready") {
					pacer.record(now());
					await params.onSend(attempts);
					return { kind: "go" };
				}
				const reason = describePause(channel, state, pacer.pacing);
				if (
					state.kind === "daily_limit" &&
					params.plan.onDailyLimit === "skip"
				) {
					return { kind: "skip", reason };
				}
				waited = await params.waitUntil(state.until, reason);
			}
			if (waited.kind !== "ok") {
				stop = waited;
				return { kind: "stop" };
			}
		}
	}

	return {
		gate,
		/** Почему последний каскад остановлен (сбрасывается при чтении). */
		takeStopReason(): StopReason | null {
			const reason = stop;
			stop = null;
			return reason;
		},
	};
}
