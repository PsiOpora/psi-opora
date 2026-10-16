import { beforeEach, describe, expect, mock, test } from "bun:test";

let crmLink: { contactId: string; dealId: string | null } | null = null;
const getBitrixCrmLink = mock(() => Promise.resolve(crmLink));
const upsertBitrixCrmLink = mock(() => Promise.resolve());
mock.module("@psi-opora/db/queries", () => ({
	getBitrixCrmLink,
	upsertBitrixCrmLink,
	getYandexMetrikaSettings: () => Promise.resolve(null),
}));
mock.module("@psi-opora/config", () => ({
	bitrixPortalKey: () => "portal",
}));

let trackerDeal: { CLOSED: string } | null = null;
const bitrixPost = mock((method: string) => {
	if (method === "crm.deal.get") return Promise.resolve(trackerDeal);
	if (method === "crm.deal.add") return Promise.resolve(777);
	return Promise.resolve(true);
});
mock.module("./client", () => ({
	bitrixPost,
	getBotId: () => "bot",
	getEnv: () => "https://example.bitrix24.ru/rest/1/x/",
	getSourceId: () => "SRC",
	getWebhookBase: () => "https://example.bitrix24.ru/rest/1/x/",
}));

mock.module("./contact", () => ({
	DEFAULT_ASSIGNED_BY_ID: 1,
	buildContactFields: () => ({}),
	buildMessengerLinkFields: () => null,
	findExistingContactId: () => Promise.resolve(null),
}));

let dealIdOnDialog: number | null = null;
mock.module("./openline", () => ({
	resolveOpenLineDialog: () =>
		Promise.resolve({
			chatId: 1,
			imol: "imol",
			contactId: 55,
			dealId: dealIdOnDialog,
			leadId: null,
		}),
}));

const { createBitrixDeal } = await import("./create-deal");

const data = {
	name: "Клиент",
	phone: "+79990000000",
	consentGranted: true,
	messenger: "max",
	telegramUserId: 100,
	chatId: 100,
	flow: "book_preorder" as const,
	categoryId: 8,
	stageId: "C8:NEW",
};

function calls(method: string) {
	return bitrixPost.mock.calls.filter((c) => c[0] === method);
}

describe("createBitrixDeal", () => {
	beforeEach(() => {
		bitrixPost.mockClear();
		crmLink = null;
		trackerDeal = { CLOSED: "N" };
		dealIdOnDialog = null;
	});

	test("сделки трекера нет — создаёт новую", async () => {
		const res = await createBitrixDeal(data);
		expect(res.dealId).toBe(777);
		expect(calls("crm.deal.add")).toHaveLength(1);
		expect(calls("crm.deal.update")).toHaveLength(0);
	});

	test("трекер уже создал сделку — переносит её в воронку, без дубля", async () => {
		dealIdOnDialog = 6104;
		const res = await createBitrixDeal(data);
		expect(res.dealId).toBe(6104);
		expect(calls("crm.deal.add")).toHaveLength(0);
		const update = calls("crm.deal.update")[0]?.[1] as {
			id: number;
			fields: Record<string, unknown>;
		};
		expect(update.id).toBe(6104);
		expect(update.fields.CATEGORY_ID).toBe(8);
		expect(update.fields.STAGE_ID).toBe("C8:NEW");
		expect(update.fields).not.toHaveProperty("ASSIGNED_BY_ID");
	});

	test("сделка диалога уже была нашей — новая заявка получает новую сделку", async () => {
		dealIdOnDialog = 6104;
		crmLink = { contactId: "55", dealId: "6104" };
		const res = await createBitrixDeal(data);
		expect(res.dealId).toBe(777);
		expect(calls("crm.deal.update")).toHaveLength(0);
	});

	test("сделка трекера закрыта — создаёт новую", async () => {
		dealIdOnDialog = 6104;
		trackerDeal = { CLOSED: "Y" };
		const res = await createBitrixDeal(data);
		expect(res.dealId).toBe(777);
	});
});
