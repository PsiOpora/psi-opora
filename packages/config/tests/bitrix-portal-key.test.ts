import { expect, test } from "bun:test";
import { bitrixPortalKey } from "../src/bitrix-portal-key";

test("OAuth domain and webhook credentials resolve to the same portal", () => {
	const expected = "portal.bitrix24.test";
	for (const endpoint of [
		"PORTAL.bitrix24.test",
		"https://portal.bitrix24.test/rest/1/token-a/",
		"https://portal.bitrix24.test/rest/2/token-b/",
	]) {
		expect(bitrixPortalKey(endpoint)).toBe(expected);
	}
	expect(bitrixPortalKey("https://other.bitrix24.test/rest/1/token/")).not.toBe(
		expected,
	);
});
