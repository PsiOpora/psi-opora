import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("@psi-opora/db/queries", () => ({
	getBitrixCrmLink: () => Promise.resolve(null),
	upsertBitrixCrmLink: () => Promise.resolve(),
	getYandexMetrikaSettings: () => Promise.resolve(null),
}));
mock.module("@psi-opora/config", () => ({
	bitrixPortalKey: () => "portal",
}));
// Диалога Открытой линии нет — контакт ищется по телефону/email.
mock.module("./openline", () => ({
	resolveOpenLineDialog: () => Promise.resolve(null),
}));

const bitrixPost = mock((method: string, _params?: unknown) => {
	if (method === "crm.contact.list") return Promise.resolve([]);
	if (method === "crm.duplicate.findbycomm") {
		return Promise.resolve({ CONTACT: [8006] });
	}
	if (method === "crm.contact.update") return Promise.resolve(true);
	return Promise.reject(new Error(`неожиданный метод в тесте: ${method}`));
});
mock.module("./client", () => ({
	bitrixPost,
	getBotId: () => "bot",
	getEnv: () => "https://example.bitrix24.ru/rest/1/x/",
	getSourceId: () => "SRC",
	getWebhookBase: () => "https://example.bitrix24.ru/rest/1/x/",
}));

const { createBitrixContact } = await import("./create-deal");

function contactUpdate() {
	const call = bitrixPost.mock.calls.find((c) => c[0] === "crm.contact.update");
	return call?.[1] as { id: number; fields: Record<string, unknown> };
}

describe("createBitrixContact: контакт уже есть в CRM (найден по телефону)", () => {
	beforeEach(() => {
		bitrixPost.mockClear();
	});

	test("согласие, данное в боте, отмечается в существующей карточке", async () => {
		const contactId = await createBitrixContact({
			name: "Клиент",
			phone: "+79990000000",
			messenger: "telegram",
			telegramUserId: 100,
			chatId: 100,
			consentGranted: true,
			consentAt: "2026-11-11T12:41:00.000Z",
		});

		expect(contactId).toBe(8006);
		expect(bitrixPost.mock.calls.some((c) => c[0] === "crm.contact.add")).toBe(
			false,
		);
		expect(contactUpdate().id).toBe(8006);
		expect(contactUpdate().fields).toMatchObject({
			UF_CRM_CONTACT_1779910236669: 1,
			UF_CRM_CONSENT_PDN_DT: "2026-11-11T12:41:00.000Z",
			PHONE: [{ VALUE: "+79990000000", VALUE_TYPE: "WORK" }],
		});
	});

	test("без согласия отметка в карточке не трогается", async () => {
		await createBitrixContact({
			name: "Клиент",
			phone: "+79990000000",
			messenger: "telegram",
			telegramUserId: 100,
			chatId: 100,
			consentGranted: false,
		});

		expect(contactUpdate().fields).not.toHaveProperty(
			"UF_CRM_CONTACT_1779910236669",
		);
		expect(contactUpdate().fields).not.toHaveProperty("UF_CRM_CONSENT_PDN_DT");
	});
});
