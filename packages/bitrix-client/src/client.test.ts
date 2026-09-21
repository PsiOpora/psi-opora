import { afterEach, describe, expect, it, mock } from "bun:test";
import { createWebhookApi } from "./client";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("BitrixApi.list", () => {
	it("не возвращает неполный список после лимита страниц", async () => {
		let calls = 0;
		globalThis.fetch = mock(async () => {
			calls++;
			return new Response(
				JSON.stringify({ result: [{ ID: String(calls) }], next: calls * 50 }),
			);
		}) as typeof fetch;

		const api = createWebhookApi("https://example.test/rest/1/token");

		await expect(api.list("crm.deal.list", { select: ["ID"] })).rejects.toThrow(
			"пагинация не завершена после 400 страниц",
		);
		expect(calls).toBe(400);
	});
});
