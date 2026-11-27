import { beforeEach, describe, expect, mock, test } from "bun:test";

const crmLinks: unknown[] = [];
const bitrixStatuses: string[] = [];
const journalEntries: {
	status: string;
	userId: string;
	externalChatId?: string;
}[] = [];
const resolveDialog = mock(
	async (_userId: string, _connectorId: string) => "79991234567",
);
const deferJournal = mock(async (_entry: unknown, _error: unknown) => {});
let sendResult: {
	ok: boolean;
	error?: string;
	externalId?: string;
	telegramUserId?: string;
} | null = null;

mock.module("@psi-opora/bitrix-client", () => ({
	resolveBitrixPortalKey: async () => "portal.test",
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
	insertBotMessage: async (entry: (typeof journalEntries)[number]) => {
		journalEntries.push(entry);
	},
	listBotMessages: async () => [],
	resolveTelegramPersonalDialogUserId: resolveDialog,
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
	upsertBitrixCrmLink: async (entry: unknown) => {
		crmLinks.push(entry);
	},
}));
mock.module("@psi-opora/tg-userbot", () => ({
	sendOutboundMessageAndWait: async () => sendResult,
	deferTelegramJournal: deferJournal,
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
		crmLinks.length = 0;
		bitrixStatuses.length = 0;
		journalEntries.length = 0;
		resolveDialog.mockClear();
		deferJournal.mockClear();
		sendResult = null;
	});

	test("keeps unconfirmed Telegram sends queued", async () => {
		await handleMessageSenderPayload(payload);
		expect(bitrixStatuses).toEqual(["queued"]);
		expect(journalEntries).toEqual([
			expect.objectContaining({ status: "queued", userId: "79991234567" }),
		]);
		expect(resolveDialog).not.toHaveBeenCalled();
	});

	test("marks confirmed Telegram sends as sent", async () => {
		sendResult = { ok: true, externalId: "sent-1" };
		await handleMessageSenderPayload(payload);
		expect(bitrixStatuses).toEqual(["sent"]);
		expect(journalEntries).toEqual([
			expect.objectContaining({ status: "sent", userId: "79991234567" }),
		]);
		expect(resolveDialog).not.toHaveBeenCalled();
	});

	test("marks confirmed Telegram errors as failed", async () => {
		sendResult = { ok: false, error: "worker error" };
		await handleMessageSenderPayload(payload);
		expect(bitrixStatuses).toEqual(["failed"]);
		expect(journalEntries).toEqual([
			expect.objectContaining({ status: "failed", userId: "79991234567" }),
		]);
		expect(resolveDialog).not.toHaveBeenCalled();
	});

	test("journals a confirmed send in the resolved dialog with its Telegram chat ID", async () => {
		sendResult = { ok: true, externalId: "sent-2", telegramUserId: "12345" };
		await handleMessageSenderPayload(payload);
		expect(resolveDialog).toHaveBeenCalledWith("12345", "connector-1");
		expect(journalEntries).toEqual([
			expect.objectContaining({
				status: "sent",
				userId: "79991234567",
				externalChatId: "12345",
			}),
		]);
		expect(deferJournal).not.toHaveBeenCalled();
	});

	test("defers only the journal when a confirmed send cannot resolve its dialog", async () => {
		const error = new Error("database unavailable");
		resolveDialog.mockRejectedValueOnce(error);
		sendResult = { ok: true, externalId: "sent-2", telegramUserId: "12345" };
		await handleMessageSenderPayload(payload);
		expect(resolveDialog).toHaveBeenCalledWith("12345", "connector-1");
		expect(journalEntries).toEqual([]);
		expect(deferJournal).toHaveBeenCalledWith(
			expect.objectContaining({
				externalId: "sent-2",
				externalChatId: "12345",
				connectorId: "connector-1",
				status: "sent",
				text: payload.text,
			}),
			error,
		);
		expect(bitrixStatuses).toEqual(["sent"]);
	});
});

test("persists the current portal for phone and canonical Telegram links", async () => {
	crmLinks.length = 0;
	sendResult = { ok: true, externalId: "sent-2", telegramUserId: "12345" };
	await handleMessageSenderPayload({
		...payload,
		contactId: "42",
		dealId: "99",
	});
	expect(crmLinks).toEqual([
		{
			portalKey: "portal.test",
			messenger: "telegram-personal",
			userId: "79991234567",
			contactId: "42",
			dealId: "99",
		},
		{
			portalKey: "portal.test",
			messenger: "telegram-personal",
			userId: "12345",
			contactId: "42",
			dealId: "99",
		},
	]);
});
