import { describe, expect, test } from "bun:test";
import { buildSessionWebhook } from "./webhook-config";

describe("buildSessionWebhook", () => {
	test("requires both webhook URL and HMAC secret", () => {
		expect(buildSessionWebhook(undefined, "secret")).toBeUndefined();
		expect(
			buildSessionWebhook("https://example.com/api/waha-webhook", undefined),
		).toBeUndefined();
	});

	test("returns complete WAHA webhook config", () => {
		expect(
			buildSessionWebhook("https://example.com/api/waha-webhook", "secret"),
		).toEqual({
			url: "https://example.com/api/waha-webhook",
			hmacKey: "secret",
		});
	});
});
