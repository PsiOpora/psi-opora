import { describe, expect, test } from "bun:test";
import { DEFAULT_SCENARIO_TEXTS } from "../scenario/texts";
import type { RedisClient } from "../storage/redis";
import {
	CONSENT_ADS_FIELD,
	CONSENT_OFFER_FIELD,
	getPendingStageDeal,
	handleStageConsentClick,
	parseStageConsentPayload,
	setPendingStageDeal,
	toInlineKeyboard,
} from "./stage-consent";

class MemoryRedis {
	values = new Map<string, unknown>();
	sets = new Map<string, Set<unknown>>();
	outbox: unknown[] = [];
	failOutbox = false;

	async get<T>(key: string): Promise<T | null> {
		return (this.values.get(key) as T | undefined) ?? null;
	}

	async set(
		key: string,
		value: unknown,
		options: { nx?: boolean } = {},
	): Promise<"OK" | null> {
		if (options.nx && this.values.has(key)) return null;
		this.values.set(key, value);
		return "OK";
	}

	async del(...keys: string[]): Promise<number> {
		let deleted = 0;
		for (const key of keys) {
			deleted += Number(this.values.delete(key));
			deleted += Number(this.sets.delete(key));
		}
		return deleted;
	}

	async sadd(key: string, ...members: unknown[]): Promise<number> {
		const set = this.sets.get(key) ?? new Set();
		const before = set.size;
		for (const member of members) set.add(member);
		this.sets.set(key, set);
		return set.size - before;
	}

	async srem(key: string, ...members: unknown[]): Promise<number> {
		const set = this.sets.get(key);
		if (!set) return 0;
		let removed = 0;
		for (const member of members) removed += Number(set.delete(member));
		return removed;
	}

	async smembers<T>(key: string): Promise<T[]> {
		return [...(this.sets.get(key) ?? [])] as T[];
	}

	async expire(): Promise<number> {
		return 1;
	}

	async zadd(_key: string, entry: { member: unknown }): Promise<number> {
		if (this.failOutbox) throw new Error("Redis unavailable");
		this.outbox.push(entry.member);
		return 1;
	}

	async eval(
		_script: string,
		keys: string[],
		args: unknown[],
	): Promise<number> {
		const key = keys[0];
		if (key && this.values.get(key) === args[0]) {
			this.values.delete(key);
			return 1;
		}
		return 0;
	}
}

function redis(memory: MemoryRedis): RedisClient {
	return memory as unknown as RedisClient;
}

describe("stage consent", () => {
	test("строит общие подписи и payload с идентификатором сделки", () => {
		const keyboard = toInlineKeyboard(
			["stage_ads_agree", "stage_ads_decline"],
			42,
			DEFAULT_SCENARIO_TEXTS,
		);

		expect(keyboard).toEqual([
			[
				{
					label: DEFAULT_SCENARIO_TEXTS.btn_stage_consent_ads_agree,
					action: "stage_ads_agree:42",
				},
				{
					label: DEFAULT_SCENARIO_TEXTS.btn_stage_consent_ads_decline,
					action: "stage_ads_decline:42",
				},
			],
		]);
		expect(parseStageConsentPayload("stage_ads_agree:42")).toEqual({
			action: "stage_ads_agree",
			dealId: 42,
		});
		expect(parseStageConsentPayload("stage_ads_agree")).toBeNull();
	});

	test("игнорирует кнопку от сделки, которая больше не ожидается", async () => {
		const memory = new MemoryRedis();
		await setPendingStageDeal(redis(memory), "telegram", 7, 43);

		const result = await handleStageConsentClick(
			redis(memory),
			"telegram",
			7,
			42,
			"stage_offer_agree",
			DEFAULT_SCENARIO_TEXTS,
		);

		expect(result).toBeNull();
		expect(memory.outbox).toHaveLength(0);
	});

	test("сохраняет оба согласия в outbox и удаляет завершённую привязку", async () => {
		const memory = new MemoryRedis();
		await setPendingStageDeal(redis(memory), "telegram", 7, 42);

		await handleStageConsentClick(
			redis(memory),
			"telegram",
			7,
			42,
			"stage_offer_agree",
			DEFAULT_SCENARIO_TEXTS,
		);
		expect(await getPendingStageDeal(redis(memory), "telegram", 7)).toBe(42);

		await handleStageConsentClick(
			redis(memory),
			"telegram",
			7,
			42,
			"stage_ads_agree",
			DEFAULT_SCENARIO_TEXTS,
		);

		expect(memory.outbox).toEqual([
			expect.objectContaining({ dealId: 42, field: CONSENT_OFFER_FIELD }),
			expect.objectContaining({ dealId: 42, field: CONSENT_ADS_FIELD }),
		]);
		expect(await getPendingStageDeal(redis(memory), "telegram", 7)).toBeNull();
	});

	test("не возвращает успешный результат при сбое durable-записи", async () => {
		const memory = new MemoryRedis();
		memory.failOutbox = true;
		await setPendingStageDeal(redis(memory), "max", 7, 42);

		expect(
			handleStageConsentClick(
				redis(memory),
				"max",
				7,
				42,
				"stage_offer_agree",
				DEFAULT_SCENARIO_TEXTS,
			),
		).rejects.toThrow("Redis unavailable");
	});

	test("повторное нажатие той же кнопки не записывает согласие ещё раз", async () => {
		const memory = new MemoryRedis();
		await setPendingStageDeal(redis(memory), "max", 7, 42);
		const click = () =>
			handleStageConsentClick(
				redis(memory),
				"max",
				7,
				42,
				"stage_offer_agree",
				DEFAULT_SCENARIO_TEXTS,
			);

		expect(await click()).toEqual({
			replyText: DEFAULT_SCENARIO_TEXTS.stage_consent_offer_agreed,
			resendAdsQuestion: false,
		});
		expect(await click()).toBeNull();
		expect(memory.outbox).toHaveLength(1);
		expect(await getPendingStageDeal(redis(memory), "max", 7)).toBe(42);
	});

	test("после сбоя записи согласие можно нажать снова", async () => {
		const memory = new MemoryRedis();
		await setPendingStageDeal(redis(memory), "max", 7, 42);
		memory.failOutbox = true;
		const click = () =>
			handleStageConsentClick(
				redis(memory),
				"max",
				7,
				42,
				"stage_ads_agree",
				DEFAULT_SCENARIO_TEXTS,
			);

		await expect(click()).rejects.toThrow("Redis unavailable");
		memory.failOutbox = false;
		expect(await click()).not.toBeNull();
		expect(memory.outbox).toHaveLength(1);
	});

	test("отказ от рассылки: переспрашивает один раз, дальше игнорирует повторы", async () => {
		const memory = new MemoryRedis();
		await setPendingStageDeal(redis(memory), "max", 7, 42);
		const decline = () =>
			handleStageConsentClick(
				redis(memory),
				"max",
				7,
				42,
				"stage_ads_decline",
				DEFAULT_SCENARIO_TEXTS,
			);

		expect((await decline())?.resendAdsQuestion).toBe(true);
		expect((await decline())?.resendAdsQuestion).toBe(false);
		expect(await decline()).toBeNull();
		expect(memory.outbox).toHaveLength(2);
	});

	test("отказ после согласия на рассылку игнорируется", async () => {
		const memory = new MemoryRedis();
		await setPendingStageDeal(redis(memory), "max", 7, 42);
		await handleStageConsentClick(
			redis(memory),
			"max",
			7,
			42,
			"stage_ads_agree",
			DEFAULT_SCENARIO_TEXTS,
		);

		expect(
			await handleStageConsentClick(
				redis(memory),
				"max",
				7,
				42,
				"stage_ads_decline",
				DEFAULT_SCENARIO_TEXTS,
			),
		).toBeNull();
		expect(memory.outbox).toHaveLength(1);
	});
});
