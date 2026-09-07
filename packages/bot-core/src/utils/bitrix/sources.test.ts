import { describe, expect, test } from "bun:test";
import type { RedisClient } from "../../storage/redis";
import {
	type DealConsentOutboxEntry,
	processDealConsentOutbox,
	setDealConsentTimestamp,
} from "./sources";

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
