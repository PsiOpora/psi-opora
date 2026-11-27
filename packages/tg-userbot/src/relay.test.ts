import { expect, mock, test } from "bun:test";

const importSessionMock = mock(() => Promise.resolve());
const destroyMock = mock(() => Promise.resolve());
const rawUser = { id: 12345 };
const getMeMock = mock(() => Promise.resolve({ raw: rawUser }));
const notifyLoggedInMock = mock(() => Promise.resolve(rawUser));

mock.module("@mtcute/core", () => ({
	MemoryStorage: class {},
	MtPeerNotFoundError: class extends Error {},
}));

mock.module("@mtcute/node", () => ({
	InputMedia: {
		photo: mock(() => ({})),
		voice: mock(() => ({})),
		document: mock(() => ({})),
	},
	proxyTransportFromUrl: mock(() => undefined),
	TelegramClient: class {
		destroy = destroyMock;
		importSession = importSessionMock;
		getMe = getMeMock;
		notifyLoggedIn = notifyLoggedInMock;
	},
}));

const { createUserbotClient } = await import("./relay");

test("createUserbotClient активирует updates loop после importSession", async () => {
	await createUserbotClient("session", { apiId: 1, apiHash: "hash" });
	expect(importSessionMock).toHaveBeenCalledWith("session");
	expect(getMeMock).toHaveBeenCalledTimes(1);
	expect(notifyLoggedInMock).toHaveBeenCalledWith(rawUser);
});

test.each([getMeMock, notifyLoggedInMock])(
	"createUserbotClient закрывает клиент при ошибке запуска updates loop",
	async (step) => {
		destroyMock.mockClear();
		const error = new Error("startup failed");
		step.mockRejectedValueOnce(error);
		destroyMock.mockRejectedValueOnce(new Error("cleanup failed"));
		await expect(
			createUserbotClient("session", { apiId: 1, apiHash: "hash" }),
		).rejects.toBe(error);
		expect(destroyMock).toHaveBeenCalledTimes(1);
	},
);
