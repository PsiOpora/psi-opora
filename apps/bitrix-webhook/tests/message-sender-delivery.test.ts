import { beforeEach, describe, expect, mock, test } from "bun:test";

const bitrixStatuses: string[] = [];
const journalStatuses: string[] = [];
let sendResult: {
	ok: boolean;
	error?: string;
	externalId?: string;
	telegramUserId?: string;
} | null = null;

mock.module("@psi-opora/bitrix-client", () => ({
	resolveBitrixApi: () => ({
		call: async (_method: string, params: { STATUS: string }) => {
			bitrixStatuses.push(params.STATUS);
		},
	}),
}));
mock.module("@psi-opora/bot-core", () => ({
	isRedisConfigured: () => false,
	createRedisClient: () => null,
}));
mock.module("@psi-opora/db/queries", () => ({
	insertBotMessage: async (entry: { status: string }) => {
		journalStatuses.push(entry.status);
	},
	listBotMessages: async () => [],
	listTelegramPersonalAccounts: async () => [
		{
			status: "connected",
			memberId: "abc123",
			openLineId: "1",
			connectorId: "connector-1",
		},
	],
	listWhatsappPersonalAccounts: async () => [],
	setWhatsappPersonalAccountStateBySession: async () => {},
	upsertBitrixCrmLink: async () => {},
}));
mock.module("@psi-opora/tg-userbot", () => ({
	sendOutboundMessageAndWait: async () => sendResult,
}));
mock.module("@psi-opora/waha", () => ({
	jidFromPhone: (phone: string) => phone,
	wahaGetSession: async () => null,
	wahaSendText: async () => ({ id: "1" }),
	wahaSessionHealth: () => ({ status: "connected" }),
}));

const { handleMessageSenderPayload } = await import("../src/message-sender");

const payload = {
	code: "psiopora_tg_personal" as const,
	messageId: "message-1",
	to: "+79991234567",
	text: "Привет",
	memberId: "abc123",
};

describe("message sender delivery states", () => {
	beforeEach(() => {
		bitrixStatuses.length = 0;
		journalStatuses.length = 0;
		sendResult = null;
	});

	test("keeps unconfirmed Telegram sends queued", async () => {
		await handleMessageSenderPayload(payload);
		expect(bitrixStatuses).toEqual(["queued"]);
		expect(journalStatuses).toEqual(["queued"]);
	});

	test("marks confirmed Telegram sends as sent", async () => {
		sendResult = { ok: true, externalId: "sent-1" };
		await handleMessageSenderPayload(payload);
		expect(bitrixStatuses).toEqual(["sent"]);
		expect(journalStatuses).toEqual(["sent"]);
	});

	test("marks confirmed Telegram errors as failed", async () => {
		sendResult = { ok: false, error: "worker error" };
		await handleMessageSenderPayload(payload);
		expect(bitrixStatuses).toEqual(["failed"]);
		expect(journalStatuses).toEqual(["failed"]);
	});
});
