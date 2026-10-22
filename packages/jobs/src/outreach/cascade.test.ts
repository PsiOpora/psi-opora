import { describe, expect, test } from "bun:test";
import {
	ChannelBreaker,
	type MessengerChannel,
	type OutreachSender,
	personalizeMessage,
	runCascade,
	type SendOutcome,
} from "./cascade";

function sender(
	channel: MessengerChannel,
	outcome: SendOutcome | (() => never),
	calls: string[] = [],
): OutreachSender {
	return {
		channel,
		send: async () => {
			calls.push(channel);
			return typeof outcome === "function" ? outcome() : outcome;
		},
	};
}

const now = () => new Date("2026-10-16T10:00:00Z");
const base = {
	phone: "+79990000001",
	email: "ivan@x.ru",
	text: "Привет",
	emailEnabled: true,
	now,
};

describe("runCascade", () => {
	test("MAX в приоритете — следующие каналы не трогаются", async () => {
		const calls: string[] = [];
		const result = await runCascade({
			...base,
			senders: [
				sender(
					"max",
					{ kind: "sent", userId: "chat-1", externalId: "m1" },
					calls,
				),
				sender("telegram", { kind: "sent", userId: "tg" }, calls),
			],
			breaker: new ChannelBreaker(),
		});
		expect(result).toMatchObject({
			status: "sent",
			channel: "max",
			userId: "chat-1",
		});
		expect(calls).toEqual(["max"]);
	});

	test("нет в MAX — уходит в Telegram", async () => {
		const result = await runCascade({
			...base,
			senders: [
				sender("max", { kind: "not_found", error: "нет в MAX" }),
				sender("telegram", { kind: "sent", userId: "42" }),
				sender("whatsapp", { kind: "sent", userId: "wa" }),
			],
			breaker: new ChannelBreaker(),
		});
		expect(result.status).toBe("sent");
		expect(result.status === "sent" && result.channel).toBe("telegram");
		expect(result.attempts).toEqual([
			{
				channel: "max",
				ok: false,
				error: "нет в MAX",
				at: now().toISOString(),
			},
			{ channel: "telegram", ok: true, at: now().toISOString() },
		]);
	});

	test("ни один мессенджер — email", async () => {
		const result = await runCascade({
			...base,
			senders: [
				sender("max", { kind: "not_found", error: "a" }),
				sender("telegram", { kind: "failed", error: "b" }),
				sender("whatsapp", () => {
					throw new Error("c");
				}),
			],
			breaker: new ChannelBreaker(),
		});
		expect(result.status).toBe("email_pending");
		expect(result.attempts.map((a) => a.error)).toEqual(["a", "b", "c"]);
	});

	test("неподтверждённая отправка останавливает каскад — без дублей", async () => {
		const calls: string[] = [];
		const result = await runCascade({
			...base,
			senders: [
				sender("max", { kind: "unknown", error: "не подтвердил" }, calls),
				sender("telegram", { kind: "sent", userId: "42" }, calls),
			],
			breaker: new ChannelBreaker(),
		});
		expect(result.status).toBe("unknown");
		expect(calls).toEqual(["max"]);
	});

	test("разовый сбой канала не выключает его — приоритет сохраняется", async () => {
		const breaker = new ChannelBreaker();
		const calls: string[] = [];
		let maxDown = true;
		const senders: OutreachSender[] = [
			{
				channel: "max",
				send: async () => {
					calls.push("max");
					return maxDown
						? { kind: "channel_down", error: "воркер не ответил" }
						: { kind: "sent", userId: "chat" };
				},
			},
			sender("telegram", { kind: "sent", userId: "42" }, calls),
		];
		await runCascade({ ...base, senders, breaker });
		maxDown = false;
		const result = await runCascade({ ...base, senders, breaker });
		expect(result.status === "sent" && result.channel).toBe("max");
		expect(calls).toEqual(["max", "telegram", "max"]);
	});

	test("несколько сбоев подряд выключают канал до конца запуска", async () => {
		const breaker = new ChannelBreaker(2);
		const calls: string[] = [];
		const senders = [
			sender(
				"max",
				{ kind: "channel_down", error: "воркер не отвечает" },
				calls,
			),
			sender("telegram", { kind: "sent", userId: "42" }, calls),
		];
		for (let i = 0; i < 3; i++) await runCascade({ ...base, senders, breaker });
		expect(calls).toEqual(["max", "telegram", "max", "telegram", "telegram"]);
	});

	test("фатальный сбой (флуд-бан) выключает канал сразу", async () => {
		const breaker = new ChannelBreaker();
		const calls: string[] = [];
		const senders = [
			sender(
				"max",
				{ kind: "channel_down", error: "FLOOD", fatal: true },
				calls,
			),
			sender("telegram", { kind: "sent", userId: "42" }, calls),
		];
		await runCascade({ ...base, senders, breaker });
		await runCascade({ ...base, senders, breaker });
		expect(calls).toEqual(["max", "telegram", "telegram"]);
	});

	test("без телефона — сразу email", async () => {
		const calls: string[] = [];
		const result = await runCascade({
			...base,
			phone: null,
			senders: [sender("max", { kind: "sent", userId: "x" }, calls)],
			breaker: new ChannelBreaker(),
		});
		expect(result.status).toBe("email_pending");
		expect(calls).toEqual([]);
	});

	test("email выключен — ошибка с причиной", async () => {
		const result = await runCascade({
			...base,
			emailEnabled: false,
			senders: [sender("max", { kind: "not_found", error: "нет в MAX" })],
			breaker: new ChannelBreaker(),
		});
		expect(result.status).toBe("failed");
		expect(result.status === "failed" && result.error).toContain("нет в MAX");
	});
});

describe("personalizeMessage", () => {
	test("подставляет имя", () => {
		expect(personalizeMessage("Здравствуйте, {{name}}!", "Анна")).toBe(
			"Здравствуйте, Анна!",
		);
	});
	test("без имени убирает плейсхолдер вместе с запятой", () => {
		expect(personalizeMessage("Здравствуйте, {{ name }}!", null)).toBe(
			"Здравствуйте!",
		);
	});
});

describe("runCascade: шлюз темпа и продолжение", () => {
	test("skip пропускает канал и пишет причину в попытки", async () => {
		const calls: string[] = [];
		const result = await runCascade({
			...base,
			senders: [
				sender("max", { kind: "sent", userId: "m" }, calls),
				sender("telegram", { kind: "sent", userId: "tg" }, calls),
			],
			breaker: new ChannelBreaker(),
			gate: async (channel) =>
				channel === "max"
					? { kind: "skip", reason: "лимит MAX" }
					: { kind: "go" },
		});
		expect(calls).toEqual(["telegram"]);
		expect(result.status === "sent" && result.channel).toBe("telegram");
		expect(result.attempts[0]).toMatchObject({
			channel: "max",
			ok: false,
			skipped: true,
			error: "лимит MAX",
		});
	});

	test("stop прерывает каскад, не трогая канал", async () => {
		const calls: string[] = [];
		const result = await runCascade({
			...base,
			senders: [
				sender("max", { kind: "not_found", error: "нет в MAX" }, calls),
				sender("telegram", { kind: "sent", userId: "tg" }, calls),
			],
			breaker: new ChannelBreaker(),
			gate: async (channel) =>
				channel === "telegram" ? { kind: "stop" } : { kind: "go" },
		});
		expect(calls).toEqual(["max"]);
		expect(result.status).toBe("interrupted");
		expect(result.attempts).toHaveLength(1);
	});

	test("продолжает с канала, на котором прервались", async () => {
		const calls: string[] = [];
		const previous = [
			{ channel: "max" as const, ok: false, error: "нет в MAX", at: "x" },
		];
		const result = await runCascade({
			...base,
			senders: [
				sender("max", { kind: "sent", userId: "m" }, calls),
				sender("telegram", { kind: "sent", userId: "tg" }, calls),
			],
			breaker: new ChannelBreaker(),
			previousAttempts: previous,
		});
		expect(calls).toEqual(["telegram"]);
		expect(result.attempts).toHaveLength(2);
	});

	test("все каналы на лимите — уходит в email", async () => {
		const result = await runCascade({
			...base,
			senders: [sender("max", { kind: "sent", userId: "m" })],
			breaker: new ChannelBreaker(),
			gate: async () => ({ kind: "skip", reason: "лимит" }),
		});
		expect(result.status).toBe("email_pending");
	});
});
