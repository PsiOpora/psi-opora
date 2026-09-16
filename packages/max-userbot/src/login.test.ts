import { describe, expect, test } from "bun:test";
import { normalizeMaxPhone, sessionInit, userAgentPayload } from "./login";
import type { MaxProtocolClient } from "./protocol/client";

function sessionInitClient(
	response: Record<string, unknown>,
): MaxProtocolClient {
	return {
		request: async () => response,
	} as MaxProtocolClient;
}

describe("userAgentPayload", () => {
	test("представляется актуальной поддерживаемой Android-сборкой MAX", () => {
		expect(userAgentPayload()).toMatchObject({
			appVersion: "26.25.0",
			buildNumber: 6790,
			deviceType: "ANDROID",
			deviceName: "samsung SM-G998B",
			installSource: "com.android.vending",
		});
	});
});

describe("normalizeMaxPhone", () => {
	test("нормализует российские форматы в E.164", () => {
		expect(normalizeMaxPhone("8 (999) 123-45-67")).toBe("+79991234567");
		expect(normalizeMaxPhone("79991234567")).toBe("+79991234567");
	});

	test("сохраняет валидный международный номер", () => {
		expect(normalizeMaxPhone("+375291234567")).toBe("+375291234567");
	});

	test("отклоняет неоднозначный номер", () => {
		expect(() => normalizeMaxPhone("9991234567")).toThrow(/международном/);
	});
});

describe("sessionInit", () => {
	test("сохраняет callsSeed в границах signed int64", async () => {
		for (const callsSeed of ["-9223372036854775808", "9223372036854775807"]) {
			const result = await sessionInit(
				sessionInitClient({ callsSeed }),
				"device-id",
				"instance-id",
			);
			expect(result.callsSeed).toBe(callsSeed);
		}
	});

	test("отклоняет callsSeed вне signed int64 и нестроковые значения", async () => {
		for (const callsSeed of [
			"-9223372036854775809",
			"9223372036854775808",
			"not-an-integer",
			123,
			null,
		]) {
			const result = await sessionInit(
				sessionInitClient({ callsSeed }),
				"device-id",
				"instance-id",
			);
			expect(result.callsSeed).toBeUndefined();
		}
	});
});
