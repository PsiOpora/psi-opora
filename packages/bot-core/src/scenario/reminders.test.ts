import { describe, expect, mock, test } from "bun:test";

// Без БД: тесты не должны ходить в Postgres (funnel/message-log/texts
// импортируют @psi-opora/db/queries).
mock.module("@psi-opora/db/queries", () => ({
	insertBotMessage: () => Promise.resolve(null),
	upsertBotFunnelEvent: () => Promise.resolve(),
	getBotTextsRecord: () => Promise.resolve({}),
}));

import type { RedisClient, StorageAdapter } from "../storage/redis";
import type { ConsultationSession } from "../types/context";

const { setFunnelUpsert } = await import("../utils/funnel");
const { runScenarioReminders } = await import("./reminders");

function setup(session: ConsultationSession) {
	const written = new Map<string, ConsultationSession>();
	const removed: string[] = [];
	const redis = {
		zrange: async () => ["100"],
		zrem: async (_key: string, member: string) => {
			removed.push(member);
			return 1;
		},
		zadd: async () => 1,
	} as unknown as RedisClient;
	const storage = {
		read: async () => structuredClone(session),
		write: async (key: string, value: ConsultationSession) => {
			written.set(key, value);
		},
	} as unknown as StorageAdapter<ConsultationSession>;
	const funnel: Array<{ step: string; reason?: string }> = [];
	setFunnelUpsert(async (e) => {
		funnel.push({ step: e.step, reason: e.reason });
	});
	return { redis, storage, written, removed, funnel };
}

const run = (s: ReturnType<typeof setup>) =>
	runScenarioReminders({
		redis: s.redis,
		storage: s.storage,
		messenger: "telegram",
		send: async () => {},
	});

describe("runScenarioReminders: таймаут после напоминания", () => {
	test("шаг phone не закрывается — помечается expired, отвал timeout записан", async () => {
		const s = setup({
			scenario: { step: "phone", flow: "consult", reminded: true },
		} as ConsultationSession);
		const result = await run(s);
		expect(result.expired).toBe(1);
		const saved = s.written.get("100")?.scenario;
		expect(saved?.step).toBe("phone");
		expect(saved?.expired).toBe(true);
		expect(s.removed).toEqual(["100"]);
		expect(s.funnel).toEqual([{ step: "phone", reason: "timeout" }]);
	});

	test("шаг consent закрывается как раньше", async () => {
		const s = setup({
			scenario: { step: "consent", flow: "consult", reminded: true },
		} as ConsultationSession);
		await run(s);
		expect(s.written.get("100")?.scenario?.step).toBe("done");
	});

	test("уже expired — повторно не считается отвалом", async () => {
		const s = setup({
			scenario: {
				step: "phone",
				flow: "consult",
				reminded: true,
				expired: true,
			},
		} as ConsultationSession);
		const result = await run(s);
		expect(result.expired).toBe(0);
		expect(s.funnel).toEqual([]);
		expect(s.removed).toEqual(["100"]);
	});
});
