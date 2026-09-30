import { beforeEach, expect, mock, test } from "bun:test";

const rpush = mock(async () => 1);
mock.module("@psi-opora/bot-core", () => ({
	createRedisClient: () => ({ rpush }),
}));
const { callMaxLoginWorker } = await import("./login-broker");

beforeEach(() => rpush.mockClear());

test.each([
	{ command: { action: "start", phone: "+79991234567" }, timeout: 45_000 },
	{ command: { action: "code", code: "123456" }, timeout: 15_000 },
	{
		command: { action: "password", passwordEncrypted: "fixture" },
		timeout: 15_000,
	},
	{ command: { action: "cancel" }, timeout: 0 },
] as const)(
	"rejects a command without enough time: $command.action",
	async ({ command, timeout }) => {
		await expect(callMaxLoginWorker("login", command, timeout)).rejects.toThrow(
			"Недостаточно времени",
		);
		expect(rpush).not.toHaveBeenCalled();
	},
);
