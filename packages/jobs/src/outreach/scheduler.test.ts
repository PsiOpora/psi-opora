import { describe, expect, test } from "bun:test";
import { ChannelPacer, type ChannelPacing, type OutreachPlan } from "./pacing";
import { createPacingGate, createWaiter } from "./scheduler";

const pacing: ChannelPacing = {
	channel: "max",
	minIntervalSec: 30,
	maxIntervalSec: 30,
	dailyLimit: 1,
	batchSize: null,
	batchPauseMin: 10,
};

/** Виртуальные часы: sleep двигает время, а не ждёт. */
function clock(startIso: string) {
	let t = new Date(startIso).getTime();
	return {
		now: () => t,
		date: () => new Date(t),
		sleep: async (ms: number) => {
			t += ms;
		},
	};
}

describe("createWaiter", () => {
	test("короткая пауза выдерживается в запуске", async () => {
		const c = clock("2026-10-22T07:00:00Z");
		const wait = createWaiter({
			runEnd: c.now() + 60 * 60 * 1000,
			isCancelled: async () => false,
			setPause: async () => {},
			sleep: c.sleep,
			now: c.now,
		});
		const result = await wait(new Date(c.now() + 45_000), "пауза");
		expect(result.kind).toBe("ok");
		expect(c.now()).toBe(new Date("2026-10-22T07:00:45Z").getTime());
	});

	test("ожидание за пределами запуска — эстафета", async () => {
		const c = clock("2026-10-22T07:00:00Z");
		const wait = createWaiter({
			runEnd: c.now() + 60_000,
			isCancelled: async () => false,
			setPause: async () => {},
			sleep: c.sleep,
			now: c.now,
		});
		const until = new Date(c.now() + 3_600_000);
		expect(await wait(until, "ночь")).toEqual({
			kind: "handoff",
			until,
			reason: "ночь",
		});
	});

	test("отмена во время ожидания", async () => {
		const c = clock("2026-10-22T07:00:00Z");
		const pauses: unknown[] = [];
		const wait = createWaiter({
			runEnd: c.now() + 60 * 60 * 1000,
			isCancelled: async () => true,
			setPause: async (p) => {
				pauses.push(p);
			},
			sleep: c.sleep,
			now: c.now,
		});
		const result = await wait(new Date(c.now() + 10 * 60_000), "перерыв");
		expect(result.kind).toBe("cancelled");
		// Пауза показана в отчёте и снята после выхода.
		expect(pauses).toHaveLength(2);
		expect(pauses[1]).toBeNull();
	});
});

describe("createPacingGate", () => {
	const setup = (plan: Partial<OutreachPlan>) => {
		const c = clock("2026-10-22T07:00:00Z");
		const pacers = new Map([
			[
				"max" as const,
				new ChannelPacer(pacing, {
					attemptsToday: 0,
					lastAt: null,
					now: c.date(),
				}),
			],
		]);
		const sent: number[] = [];
		const gate = createPacingGate({
			plan: { channels: [pacing], onDailyLimit: "skip", window: null, ...plan },
			pacers,
			waitUntil: createWaiter({
				runEnd: c.now() + 60 * 60 * 1000,
				isCancelled: async () => false,
				setPause: async () => {},
				sleep: c.sleep,
				now: c.now,
			}),
			onSend: async () => {
				sent.push(c.now());
			},
			now: c.date,
		});
		return { gate, sent };
	};

	test("лимит исчерпан и onDailyLimit=skip — канал пропускается", async () => {
		const { gate, sent } = setup({});
		expect((await gate.gate("max", [])).kind).toBe("go");
		const second = await gate.gate("max", []);
		expect(second.kind).toBe("skip");
		expect(sent).toHaveLength(1);
	});

	test("лимит исчерпан и onDailyLimit=wait — эстафета до полуночи МСК", async () => {
		const { gate } = setup({ onDailyLimit: "wait" });
		await gate.gate("max", []);
		expect((await gate.gate("max", [])).kind).toBe("stop");
		expect(gate.takeStopReason()).toMatchObject({
			kind: "handoff",
			until: new Date("2026-10-22T21:00:00Z"),
		});
	});

	test("вне окна отправки — ждём открытия", async () => {
		const { gate } = setup({
			window: { days: [1, 2, 3, 4, 5], fromHour: 12, toHour: 18 },
		});
		expect((await gate.gate("max", [])).kind).toBe("stop");
		expect(gate.takeStopReason()).toMatchObject({
			kind: "handoff",
			reason: "Вне окна отправки",
			until: new Date("2026-10-22T09:00:00Z"),
		});
	});
});
