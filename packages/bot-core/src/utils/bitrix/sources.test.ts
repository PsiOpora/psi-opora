import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { RedisClient } from "../../storage/redis";
import {
	appendDealComment,
	type DealConsentOutboxEntry,
	processDealConsentOutbox,
	setDealConsentTimestamp,
} from "./sources";

describe("appendDealComment", () => {
	const originalWebhook = process.env.MAX_BITRIX_WEBHOOK_URL;
	let fetchMock: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

	beforeEach(() => {
		process.env.MAX_BITRIX_WEBHOOK_URL =
			"https://bitrix.example.test/rest/1/test";
		fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
			Response.json({ result: 77 }),
		);
	});

	afterEach(() => {
		fetchMock.mockRestore();
		if (originalWebhook === undefined)
			delete process.env.MAX_BITRIX_WEBHOOK_URL;
		else process.env.MAX_BITRIX_WEBHOOK_URL = originalWebhook;
	});

	test("возвращает true после подтверждённой записи комментария", async () => {
		expect(await appendDealComment("max", 6104, "Телефон: 9109084657")).toBe(
			true,
		);
		const [url, init] = fetchMock.mock.calls[0] ?? [];
		expect(String(url)).toEndWith("/crm.timeline.comment.add.json");
		expect(JSON.parse(String(init?.body))).toEqual({
			fields: {
				ENTITY_ID: 6104,
				ENTITY_TYPE: "deal",
				COMMENT: "Телефон: 9109084657",
			},
		});
	});

	test("перехваченная ошибка Bitrix возвращает false", async () => {
		fetchMock.mockResolvedValueOnce(Response.json({ error: "COMMENT_FAILED" }));
		expect(await appendDealComment("max", 6104, "Телефон")).toBe(false);
	});

	test("ответ без ID комментария не считается успехом", async () => {
		fetchMock.mockResolvedValueOnce(Response.json({ result: false }));
		expect(await appendDealComment("max", 6104, "Телефон")).toBe(false);
	});

	test("без вебхука или сделки возвращает false без запроса", async () => {
		expect(await appendDealComment("max", 0, "Телефон")).toBe(false);
		process.env.MAX_BITRIX_WEBHOOK_URL = "";
		expect(await appendDealComment("max", 6104, "Телефон")).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

class OutboxRedis {
	entries: DealConsentOutboxEntry[] = [];
	removed: DealConsentOutboxEntry[] = [];

	async zadd(
		_key: string,
		entry: { member: DealConsentOutboxEntry },
	): Promise<number> {
		this.entries.push(entry.member);
		return 1;
	}

	async zrange<T>(): Promise<T> {
		return [...this.entries] as T;
	}

	async zrem(_key: string, ...entries: DealConsentOutboxEntry[]) {
		this.removed.push(...entries);
		return entries.length;
	}
}

describe("deal consent outbox", () => {
	test("сохраняет запись до обращения к Bitrix", async () => {
		const memory = new OutboxRedis();
		await setDealConsentTimestamp(
			memory as unknown as RedisClient,
			"telegram",
			42,
			"UF_CONSENT",
			"2026-09-07T10:00:00.000Z",
		);

		expect(memory.entries).toEqual([
			{
				messenger: "telegram",
				dealId: 42,
				field: "UF_CONSENT",
				at: "2026-09-07T10:00:00.000Z",
			},
		]);
	});

	test("удаляет доставленную запись только после crm.deal.update", async () => {
		const memory = new OutboxRedis();
		memory.entries.push({
			messenger: "telegram",
			dealId: 42,
			field: "UF_CONSENT",
			at: "2026-09-07T10:00:00.000Z",
		});
		let delivered: DealConsentOutboxEntry | undefined;

		const result = await processDealConsentOutbox(
			memory as unknown as RedisClient,
			100,
			async (entry) => {
				delivered = entry;
			},
		);

		expect(delivered).toEqual({
			messenger: "telegram",
			dealId: 42,
			field: "UF_CONSENT",
			at: "2026-09-07T10:00:00.000Z",
		});
		expect(result).toEqual({ processed: 1, failed: 0 });
		expect(memory.removed).toEqual(memory.entries);
	});

	test("оставляет запись для повтора после ошибки Bitrix", async () => {
		const memory = new OutboxRedis();
		memory.entries.push({
			messenger: "telegram",
			dealId: 42,
			field: "UF_CONSENT",
			at: "2026-09-07T10:00:00.000Z",
		});
		const result = await processDealConsentOutbox(
			memory as unknown as RedisClient,
			100,
			async () => {
				throw new Error("TEMPORARY_ERROR");
			},
		);

		expect(result).toEqual({ processed: 0, failed: 1 });
		expect(memory.removed).toHaveLength(0);
	});
});
