import { describe, expect, test } from "bun:test";
import {
	claimCallbackClick,
	completeCallbackClick,
	releaseCallbackClick,
} from "./callback-dedupe";

describe("claimCallbackClick (без Redis)", () => {
	test("засчитывает только первое нажатие на сообщение", async () => {
		expect(await claimCallbackClick(undefined, "max", 1, "m-first")).toBe(true);
		expect(await claimCallbackClick(undefined, "max", 1, "m-first")).toBe(
			false,
		);
		expect(await claimCallbackClick(undefined, "max", 1, "m-first")).toBe(
			false,
		);
	});

	test("другое сообщение или другой пользователь — независимы", async () => {
		expect(await claimCallbackClick(undefined, "max", 1, "m-a")).toBe(true);
		expect(await claimCallbackClick(undefined, "max", 1, "m-b")).toBe(true);
		expect(await claimCallbackClick(undefined, "max", 2, "m-a")).toBe(true);
		expect(await claimCallbackClick(undefined, "telegram", 1, "m-a")).toBe(
			true,
		);
	});

	test("после release нажатие можно повторить", async () => {
		expect(await claimCallbackClick(undefined, "max", 1, "m-rel")).toBe(true);
		await releaseCallbackClick(undefined, "max", 1, "m-rel");
		expect(await claimCallbackClick(undefined, "max", 1, "m-rel")).toBe(true);
	});

	test("с Redis использует SET NX с TTL", async () => {
		const calls: Array<{ key: string; opts: unknown }> = [];
		const seen = new Set<string>();
		const redis = {
			set: async (key: string, _v: unknown, opts: unknown) => {
				calls.push({ key, opts });
				if (seen.has(key)) return null;
				seen.add(key);
				return "OK";
			},
			del: async (key: string) => (seen.delete(key) ? 1 : 0),
		} as never;
		expect(await claimCallbackClick(redis, "max", 1, "x")).toBe(true);
		expect(await claimCallbackClick(redis, "max", 1, "x")).toBe(false);
		expect(calls[0]?.opts).toEqual({ nx: true, ex: 60 });
		await releaseCallbackClick(redis, "max", 1, "x");
		expect(await claimCallbackClick(redis, "max", 1, "x")).toBe(true);
	});
});

test("failed DEL leaves only a short claim, successful completion lasts 30 days", async () => {
	let now = 0;
	let expiresAt = 0;
	const redis = {
		set: async (
			_key: string,
			_value: unknown,
			options: { nx?: boolean; ex: number },
		) => {
			if (options.nx && expiresAt > now) return null;
			expiresAt = now + options.ex;
			return "OK";
		},
		del: async () => {
			throw new Error("offline");
		},
	} as never;
	expect(await claimCallbackClick(redis, "max", 1, "retry")).toBe(true);
	await releaseCallbackClick(redis, "max", 1, "retry");
	expect(await claimCallbackClick(redis, "max", 1, "retry")).toBe(false);
	now = 61;
	expect(await claimCallbackClick(redis, "max", 1, "retry")).toBe(true);
	await completeCallbackClick(redis, "max", 1, "retry");
	now += 29 * 24 * 60 * 60;
	expect(await claimCallbackClick(redis, "max", 1, "retry")).toBe(false);
	now += 2 * 24 * 60 * 60;
	expect(await claimCallbackClick(redis, "max", 1, "retry")).toBe(true);
});

test("memory claim expires quickly, completion preserves dedupe", async () => {
	const originalNow = Date.now;
	let now = originalNow();
	Date.now = () => now;
	try {
		expect(await claimCallbackClick(undefined, "max", 1, "memory-expire")).toBe(
			true,
		);
		now += 61_000;
		expect(await claimCallbackClick(undefined, "max", 1, "memory-expire")).toBe(
			true,
		);
		await completeCallbackClick(undefined, "max", 1, "memory-expire");
		now += 24 * 60 * 60 * 1000;
		expect(await claimCallbackClick(undefined, "max", 1, "memory-expire")).toBe(
			false,
		);
	} finally {
		Date.now = originalNow;
	}
});
