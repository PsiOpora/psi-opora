import { describe, expect, test } from "bun:test";
import { normalizeMaxPhone, userAgentPayload } from "./login";

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
