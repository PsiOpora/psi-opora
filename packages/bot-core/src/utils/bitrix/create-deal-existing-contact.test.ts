import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { OpenLineDialog } from "./openline";

const upsertBitrixCrmLink = mock(() => Promise.resolve());
mock.module("@psi-opora/db/queries", () => ({
	getBitrixCrmLink: () => Promise.resolve(null),
	upsertBitrixCrmLink,
	getYandexMetrikaSettings: () => Promise.resolve(null),
}));
mock.module("@psi-opora/config", () => ({
	bitrixPortalKey: () => "portal",
}));
let dialog: OpenLineDialog | null = null;
mock.module("./openline", () => ({
	resolveOpenLineDialog: () => Promise.resolve(dialog),
}));

const bitrixPost = mock((method: string, _params?: unknown) => {
	if (method === "crm.contact.list") return Promise.resolve([]);
	if (method === "crm.duplicate.findbycomm") {
		return Promise.resolve({ CONTACT: [8006] });
	}
	if (method === "crm.contact.update") return Promise.resolve(true);
	if (method === "crm.contact.add") return Promise.resolve(9001);
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

/** Параметры единственного вызова crm.contact.update в тесте. */
function contactUpdate() {
	const call = bitrixPost.mock.calls.find((c) => c[0] === "crm.contact.update");
	return call?.[1] as { id: number; fields: Record<string, unknown> };
}

describe("createBitrixContact: контакт уже есть в CRM (найден по телефону)", () => {
	beforeEach(() => {
		dialog = null;
		bitrixPost.mockClear();
		upsertBitrixCrmLink.mockClear();
	});

	for (const comm of [
		{ phone: "+79990000000" },
		{ email: "other@example.test" },
	]) {
		test(`согласие сохраняется отдельно от совпадения ${Object.keys(comm)[0]}`, async () => {
			const contactId = await createBitrixContact({
				name: "Клиент",
				...comm,
				messenger: "telegram",
				telegramUserId: 100,
				chatId: 100,
				consentGranted: true,
				consentAt: "2026-11-11T12:41:00.000Z",
			});

			expect(contactId).toBe(9001);
			expect(
				bitrixPost.mock.calls.some((c) => c[0] === "crm.contact.update"),
			).toBe(false);
			const added = bitrixPost.mock.calls.find(
				(c) => c[0] === "crm.contact.add",
			);
			expect(added?.[1]).toMatchObject({
				fields: {
					UF_CRM_CONTACT_1779910236669: 1,
					UF_CRM_CONSENT_PDN_DT: "2026-11-11T12:41:00.000Z",
					IM: [{ VALUE: "100", VALUE_TYPE: "telegram" }],
				},
			});
			expect(upsertBitrixCrmLink).toHaveBeenCalledWith(
				expect.objectContaining({ userId: "100", contactId: "9001" }),
			);
		});
	}

	test("согласие записывается в контакт, связанный с диалогом пользователя", async () => {
		dialog = {
			contactId: 8006,
			chatId: 42,
			imol: "imol|bot|1|100|42",
			dealId: null,
			leadId: null,
		};
		const contactId = await createBitrixContact({
			name: "Клиент",
			phone: "+79990000000",
			telegramUserId: 100,
			chatId: 100,
			consentGranted: true,
			consentAt: "2026-11-11T12:41:00.000Z",
		});
		expect(contactId).toBe(8006);
		expect(contactUpdate().fields).toMatchObject({
			UF_CRM_CONTACT_1779910236669: 1,
			UF_CRM_CONSENT_PDN_DT: "2026-11-11T12:41:00.000Z",
		});
		expect(bitrixPost.mock.calls.some((c) => c[0] === "crm.contact.add")).toBe(
			false,
		);
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
