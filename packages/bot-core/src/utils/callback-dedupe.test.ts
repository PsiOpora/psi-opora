import { describe, expect, test } from "bun:test";
import { claimCallbackClick, releaseCallbackClick } from "./callback-dedupe";

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
		expect(calls[0]?.opts).toEqual({ nx: true, ex: 30 * 24 * 60 * 60 });
		await releaseCallbackClick(redis, "max", 1, "x");
		expect(await claimCallbackClick(redis, "max", 1, "x")).toBe(true);
	});
});
