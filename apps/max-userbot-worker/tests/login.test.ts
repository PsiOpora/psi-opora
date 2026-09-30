import { expect, mock, spyOn, test } from "bun:test";
import type { QueuedMaxLoginCommand } from "@psi-opora/max-userbot";

mock.module("@psi-opora/bot-core", () => ({ createRedisClient: () => ({}) }));
const { assertMaxLoginCommandDeadline } = await import(
	"@psi-opora/max-userbot"
);
const submitCode = mock(async () => ({ status: "password_required" }));
const submitPassword = mock(async () => ({
	status: "connected",
	session: "fixture",
}));
const close = mock(() => {});
let releaseStart: (() => void) | undefined;
const start = mock(async () => {
	await new Promise<void>((resolve) => {
		releaseStart = resolve;
	});
	return {
		flow: { submitCode, submitPassword, close },
		result: { status: "code_sent", phone: "+79991234567", codeLength: 6 },
	};
});
const reply = mock(async (_requestId: string, _reply: unknown) => {});
mock.module("@psi-opora/max-userbot", () => ({
	assertMaxLoginCommandDeadline,
	MaxLoginFlow: { start },
	claimMaxLoginCommand: async () => null,
	replyMaxLoginCommand: reply,
	decryptSecret: (value: string) => value,
	encryptSecret: (value: string) => value,
}));
const { enqueue } = await import("../src/login");

test("rechecks commands after waiting in the per-login queue", async () => {
	let now = 1_000_000;
	const clock = spyOn(Date, "now").mockImplementation(() => now);
	const queued = (
		requestId: string,
		command: QueuedMaxLoginCommand["command"],
		expiresAt = now + 50_000,
	): QueuedMaxLoginCommand => ({
		requestId,
		loginId: "queued-login",
		expiresAt,
		command,
	});
	try {
		const first = enqueue(
			queued("first", { action: "start", phone: "+79991234567" }),
		);
		await Promise.resolve();
		const waiting = [
			enqueue(queued("start", { action: "start", phone: "+79991234567" })),
			enqueue(queued("code", { action: "code", code: "123456" }, now + 20_000)),
			enqueue(
				queued(
					"password",
					{ action: "password", passwordEncrypted: "fixture" },
					now + 20_000,
				),
			),
			enqueue(queued("cancel", { action: "cancel" }, now + 5_000)),
		];
		now += 10_000;
		releaseStart?.();
		await first;
		await Promise.all(waiting);
		expect(start).toHaveBeenCalledTimes(1);
		expect(submitCode).not.toHaveBeenCalled();
		expect(submitPassword).not.toHaveBeenCalled();
		expect(close).not.toHaveBeenCalled();
		for (const requestId of ["start", "code", "password", "cancel"]) {
			expect(reply).toHaveBeenCalledWith(requestId, {
				ok: false,
				error: expect.stringContaining("Недостаточно времени"),
			});
		}
		await enqueue(queued("fresh-code", { action: "code", code: "123456" }));
		expect(submitCode).toHaveBeenCalledTimes(1);
	} finally {
		await enqueue(queued("cleanup", { action: "cancel" }));
		clock.mockRestore();
	}
});
