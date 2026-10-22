import { describe, expect, test } from "bun:test";
import {
	ChannelPacer,
	type ChannelPacing,
	moscowDayStart,
	nextWindowOpening,
	resolveOutreachPlan,
} from "./pacing";

const pacing: ChannelPacing = {
	channel: "telegram",
	minIntervalSec: 30,
	maxIntervalSec: 60,
	dailyLimit: null,
	batchSize: null,
	batchPauseMin: 10,
};

// 2026-10-22 — четверг; 07:00Z = 10:00 МСК.
const at = (iso: string) => new Date(iso);

describe("moscowDayStart", () => {
	test("сутки начинаются в полночь по Москве", () => {
		expect(moscowDayStart(at("2026-10-22T07:00:00Z")).toISOString()).toBe(
			"2026-10-21T21:00:00.000Z",
		);
		// 23:30 МСК 21-го ещё 21-е, 00:30 МСК — уже 22-е.
		expect(moscowDayStart(at("2026-10-21T20:30:00Z")).toISOString()).toBe(
			"2026-10-20T21:00:00.000Z",
		);
		expect(moscowDayStart(at("2026-10-21T21:30:00Z")).toISOString()).toBe(
			"2026-10-21T21:00:00.000Z",
		);
	});
});

describe("nextWindowOpening", () => {
	const weekdays = { days: [1, 2, 3, 4, 5], fromHour: 10, toHour: 20 };

	test("внутри окна — null", () => {
		expect(nextWindowOpening(at("2026-10-22T07:00:00Z"), weekdays)).toBeNull();
	});

	test("до начала окна — сегодня в fromHour", () => {
		expect(
			nextWindowOpening(at("2026-10-22T05:00:00Z"), weekdays)?.toISOString(),
		).toBe("2026-10-22T07:00:00.000Z");
	});

	test("вечер пятницы — понедельник утром", () => {
		// 23.10 пятница, 21:00 МСК.
		expect(
			nextWindowOpening(at("2026-10-23T18:00:00Z"), weekdays)?.toISOString(),
		).toBe("2026-10-26T07:00:00.000Z");
	});

	test("окно не задано — null", () => {
		expect(nextWindowOpening(at("2026-10-22T05:00:00Z"), null)).toBeNull();
	});
});

describe("ChannelPacer", () => {
	const now = at("2026-10-22T07:00:00Z");
	const plus = (sec: number) => new Date(now.getTime() + sec * 1000);

	test("первое сообщение сразу, следующее — после паузы", () => {
		const pacer = new ChannelPacer(
			pacing,
			{ attemptsToday: 0, lastAt: null, now },
			() => 0,
		);
		expect(pacer.state(now).kind).toBe("ready");
		pacer.record(now);
		expect(pacer.state(plus(10))).toEqual({
			kind: "interval",
			until: plus(30),
		});
		expect(pacer.state(plus(30)).kind).toBe("ready");
	});

	test("пауза отсчитывается от последней отправки прошлого запуска", () => {
		const pacer = new ChannelPacer(
			pacing,
			{ attemptsToday: 3, lastAt: plus(-10), now },
			() => 1,
		);
		expect(pacer.state(now)).toEqual({ kind: "interval", until: plus(50) });
	});

	test("перерыв после каждых N сообщений", () => {
		const pacer = new ChannelPacer(
			{ ...pacing, batchSize: 2, batchPauseMin: 10 },
			{ attemptsToday: 0, lastAt: null, now },
			() => 0,
		);
		pacer.record(now);
		pacer.record(plus(30));
		expect(pacer.state(plus(60))).toEqual({
			kind: "break",
			until: plus(30 + 600),
		});
	});

	test("дневной лимит — до полуночи по Москве, потом сбрасывается", () => {
		const pacer = new ChannelPacer(
			{ ...pacing, dailyLimit: 5 },
			{ attemptsToday: 5, lastAt: null, now },
		);
		expect(pacer.state(now)).toEqual({
			kind: "daily_limit",
			until: at("2026-10-22T21:00:00Z"),
		});
		expect(pacer.state(at("2026-10-22T21:00:01Z")).kind).toBe("ready");
	});
});

describe("resolveOutreachPlan", () => {
	test("старые рассылки — MAX → Telegram → WhatsApp, пауза ±25%", () => {
		const plan = resolveOutreachPlan({
			settings: null,
			accounts: { max: null, telegram: {}, whatsapp: {} },
			intervalSec: 40,
		});
		expect(plan.channels.map((c) => c.channel)).toEqual([
			"telegram",
			"whatsapp",
		]);
		expect(plan.channels[0]).toMatchObject({
			minIntervalSec: 30,
			maxIntervalSec: 50,
			dailyLimit: null,
		});
	});

	test("порядок — из настроек", () => {
		const plan = resolveOutreachPlan({
			settings: {
				channels: [
					{ ...pacing, channel: "whatsapp" },
					{ ...pacing, channel: "max" },
				],
				onDailyLimit: "wait",
				window: null,
			},
			accounts: { max: {}, telegram: null, whatsapp: {} },
			intervalSec: 30,
		});
		expect(plan.channels.map((c) => c.channel)).toEqual(["whatsapp", "max"]);
		// Настройки без useBots — рассылка создана до шага с ботами.
		expect(plan.useBots).toBe(false);
	});

	test("боты включены в настройках", () => {
		const plan = resolveOutreachPlan({
			settings: {
				useBots: true,
				channels: [pacing],
				onDailyLimit: "skip",
				window: null,
			},
			accounts: { max: null, telegram: {}, whatsapp: null },
			intervalSec: 30,
		});
		expect(plan.useBots).toBe(true);
	});
});
