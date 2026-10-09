import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { resolveBitrixPortalKey } from "./portal-key";
import * as tokens from "./tokens";

afterEach(() => mock.restore());
test("resolves the current OAuth portal domain", async () => {
	const getTokens = spyOn(tokens, "getPortalTokens").mockResolvedValue({
		domain: "PORTAL.test",
	} as tokens.PortalTokens);
	expect(await resolveBitrixPortalKey("member-a")).toBe("portal.test");
	expect(getTokens).toHaveBeenCalledWith("member-a");
});
test("does not substitute a webhook for a portal with missing tokens", async () => {
	spyOn(tokens, "getPortalTokens").mockResolvedValue(undefined);
	await expect(resolveBitrixPortalKey("missing-member")).rejects.toThrow(
		"Cannot resolve Bitrix portal key",
	);
});
