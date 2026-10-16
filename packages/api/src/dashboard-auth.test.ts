import { describe, expect, test } from "bun:test";
import { createRouterClient } from "@orpc/server";
import { createORPCContext } from "./orpc";
import { appRouter } from "./routers";
import { maskSecret } from "./routers/email";

const anonymousClient = createRouterClient(appRouter, {
	context: createORPCContext({
		headers: new Headers(),
		session: null,
		memberId: null,
		bitrixSession: null,
	}),
});

function expectUnauthorized(call: () => Promise<unknown>) {
	return expect(call()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
}

describe("dashboard authorization", () => {
	test("rejects anonymous reads of provider secrets", async () => {
		await expectUnauthorized(() => anonymousClient.email.getSettings());
		await expectUnauthorized(() => anonymousClient.email.getRusenderSettings());
		await expectUnauthorized(() => anonymousClient.email.getSmtpBzSettings());
		await expectUnauthorized(() => anonymousClient.email.getResendSettings());
		await expectUnauthorized(() => anonymousClient.ads.getCredentials());
		await expectUnauthorized(() => anonymousClient.backup.getCredentials());
		await expectUnauthorized(() => anonymousClient.yandexMetrika.getSettings());
	});

	test("rejects anonymous writes before side effects", async () => {
		await expectUnauthorized(() =>
			anonymousClient.email.upsertRusenderSettings({ apiKey: "attacker" }),
		);
		await expectUnauthorized(() =>
			anonymousClient.email.setProvider({ provider: "unisender" }),
		);
		await expectUnauthorized(() => anonymousClient.backup.runNow());
		await expectUnauthorized(() => anonymousClient.telegramPersonal.list());
		await expectUnauthorized(() => anonymousClient.whatsappPersonal.list());
		await expectUnauthorized(() => anonymousClient.maxPersonal.list());
	});
});

describe("maskSecret", () => {
	test("returns null for a missing key", () => {
		expect(maskSecret(null)).toBeNull();
		expect(maskSecret("")).toBeNull();
	});

	test("shows only the last 4 characters of a long key", () => {
		expect(maskSecret("rs_ck_v1_abcdef123456")).toBe("••••3456");
	});

	test("hides short keys entirely", () => {
		expect(maskSecret("short1234")).toBe("••••");
	});
});
