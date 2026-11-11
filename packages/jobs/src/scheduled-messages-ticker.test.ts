import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
	type ScheduledMessagesTicker,
	startScheduledMessagesTicker,
} from "./scheduled-messages-ticker";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let ticker: ScheduledMessagesTicker | null = null;

afterEach(async () => {
	await ticker?.stop();
	ticker = null;
});

describe("startScheduledMessagesTicker", () => {
	test("запускает отправку сразу и затем по интервалу", async () => {
		let calls = 0;
		ticker = startScheduledMessagesTicker(
			async () => {
				calls++;
				return { sent: 0 };
			},
			{ intervalMs: 20 },
		);
		await sleep(70);
		expect(calls).toBeGreaterThanOrEqual(3);
	});

	test("не стартует поверх незавершённой отправки", async () => {
		let calls = 0;
		let release: () => void = () => {};
		ticker = startScheduledMessagesTicker(
			() => {
				calls++;
				return new Promise((resolve) => {
					release = () => resolve({ sent: 1 });
				});
			},
			{ intervalMs: 10 },
		);
		await sleep(60);
		expect(calls).toBe(1);
		release();
		await sleep(40);
		expect(calls).toBe(2);
		release();
	});

	test("сбой отправки не останавливает таймер", async () => {
		const error = spyOn(console, "error").mockImplementation(() => {});
		try {
			let calls = 0;
			ticker = startScheduledMessagesTicker(
				async () => {
					calls++;
					throw new Error("база недоступна");
				},
				{ intervalMs: 15 },
			);
			await sleep(60);
			expect(calls).toBeGreaterThanOrEqual(2);
			expect(error).toHaveBeenCalled();
		} finally {
			error.mockRestore();
		}
	});

	test("зависшая отправка не блокирует следующие запуски", async () => {
		const error = spyOn(console, "error").mockImplementation(() => {});
		try {
			let calls = 0;
			ticker = startScheduledMessagesTicker(
				() => {
					calls++;
					// Первый запуск не завершается никогда.
					return calls === 1
						? new Promise(() => {})
						: Promise.resolve({ sent: 0 });
				},
				{ intervalMs: 10, stuckAfterMs: 30 },
			);
			await sleep(100);
			expect(calls).toBeGreaterThanOrEqual(2);
		} finally {
			error.mockRestore();
		}
	});

	test("stop дожидается текущей отправки и прекращает запуски", async () => {
		let calls = 0;
		let finished = false;
		const local = startScheduledMessagesTicker(
			async () => {
				calls++;
				await sleep(30);
				finished = true;
				return { sent: 1 };
			},
			{ intervalMs: 1000 },
		);
		await sleep(5);
		await local.stop();
		expect(finished).toBe(true);
		await sleep(30);
		expect(calls).toBe(1);
	});
});
