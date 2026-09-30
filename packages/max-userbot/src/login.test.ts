import { describe, expect, test } from "bun:test";
import {
	MAX_CLIENT_BUILD,
	normalizeMaxPhone,
	sessionInit,
	userAgentPayload,
} from "./login";
import type { MaxProtocolClient } from "./protocol/client";

function sessionInitClient(
	response: Record<string, unknown>,
): MaxProtocolClient {
	return {
		request: async () => response,
	} as MaxProtocolClient;
}

describe("userAgentPayload", () => {
	test("представляется той же сборкой MAX, чьи дайджесты уходят в mode", () => {
		expect(userAgentPayload()).toMatchObject({
			appVersion: MAX_CLIENT_BUILD.appVersion,
			buildNumber: MAX_CLIENT_BUILD.buildNumber,
			deviceType: "ANDROID",
		});
	});

	test("повторяет набор и порядок полей SESSION_INIT у Komet (kolibri-net)", () => {
		expect(Object.keys(userAgentPayload())).toEqual([
			"deviceType",
			"appVersion",
			"osVersion",
			"timezone",
			"screen",
			"pushDeviceType",
			"locale",
			"deviceName",
			"deviceLocale",
			"arch",
			"buildNumber",
		]);
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

	test("принимает callsSeed, закодированный компактным msgpack-целым", async () => {
		const result = await sessionInit(
			sessionInitClient({ callsSeed: 123 }),
			"device-id",
			"instance-id",
		);
		expect(result.callsSeed).toBe("123");
	});

	test("отклоняет callsSeed вне signed int64 и нецелые значения", async () => {
		for (const callsSeed of [
			"-9223372036854775809",
			"9223372036854775808",
			"not-an-integer",
			1.5,
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
