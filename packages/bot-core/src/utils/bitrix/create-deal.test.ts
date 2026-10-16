import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import type { OpenLineDialog } from "./openline";

const upsertBitrixCrmLink = mock(() => Promise.resolve());
const getBitrixCrmLink = mock(() => Promise.resolve(null));
mock.module("@psi-opora/db/queries", () => ({
	getBitrixCrmLink,
	upsertBitrixCrmLink,
}));

let dialog: OpenLineDialog | null = null;
mock.module("./openline", () => ({
	resolveOpenLineDialog: () => Promise.resolve(dialog),
}));
mock.module("./deal", () => ({
	buildDealFields: (_data: unknown, contactId: number) => ({
		CONTACT_ID: contactId,
	}),
	linkBitrixTrace: () => Promise.resolve(),
}));

const { createBitrixContact, createBitrixDeal } = await import("./create-deal");
const { appendPhoneToTrackerDeal } = await import("./tracker-phone");

const data = {
	name: "Клиент",
	phone: "9109084657",
	email: "client@example.test",
	messenger: "max",
	telegramUserId: 123,
	chatId: 123,
};
const originalWebhook = process.env.MAX_BITRIX_WEBHOOK_URL;
const originalSource = process.env.MAX_BITRIX_SOURCE_ID;
let fetchMock: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
let updates: Array<boolean | Error>;

describe("createBitrixContact / createBitrixDeal: подтверждение телефона", () => {
	beforeEach(() => {
		dialog = {
			chatId: 10,
			imol: "imol|bot|1|123|10",
			contactId: 501,
			dealId: null,
			leadId: null,
		};
		updates = [true];
		upsertBitrixCrmLink.mockClear();
		process.env.MAX_BITRIX_WEBHOOK_URL =
			"https://bitrix.example.test/rest/1/test";
		process.env.MAX_BITRIX_SOURCE_ID = "TEST";
		fetchMock = spyOn(globalThis, "fetch").mockImplementation(
			Object.assign(
				async (input: RequestInfo | URL, init?: RequestInit) => {
					const method = String(input).split("/").at(-1)?.replace(".json", "");
					if (method === "crm.contact.update") {
						const result = updates.shift();
						return result instanceof Error
							? Response.json({
									error: "UPDATE_FAILED",
									error_description: result.message,
								})
							: Response.json({ result });
					}
					if (method === "crm.duplicate.findbycomm") {
						const body = JSON.parse(String(init?.body));
						return Response.json({
							result: body.type === "EMAIL" ? { CONTACT: [501] } : {},
						});
					}
					if (method === "crm.deal.add") return Response.json({ result: 77 });
					throw new Error(`Неожиданный запрос: ${method}`);
				},
				{ preconnect: globalThis.fetch.preconnect },
			),
		);
	});

	afterEach(() => {
		fetchMock.mockRestore();
		if (originalWebhook === undefined)
			delete process.env.MAX_BITRIX_WEBHOOK_URL;
		else process.env.MAX_BITRIX_WEBHOOK_URL = originalWebhook;
		if (originalSource === undefined) delete process.env.MAX_BITRIX_SOURCE_ID;
		else process.env.MAX_BITRIX_SOURCE_ID = originalSource;
	});

	test.each([false, new Error("crm.contact.update")])(
		"не возвращает ID контакта после отказа обновления (%s)",
		async (result) => {
			updates = [result];
			await expect(createBitrixContact(data)).rejects.toThrow();
			expect(upsertBitrixCrmLink).not.toHaveBeenCalled();
		},
	);

	test("повторяет запись телефона до создания сделки после первого сбоя", async () => {
		updates = [new Error("temporary"), true];
		await expect(createBitrixContact(data)).rejects.toThrow();

		expect(await createBitrixDeal(data)).toEqual({
			contactId: 501,
			dealId: 77,
		});
		expect(
			fetchMock.mock.calls.map(([url]) => String(url).split("/").at(-1)),
		).toEqual([
			"crm.contact.update.json",
			"crm.contact.update.json",
			"crm.deal.add.json",
		]);
		for (const [, init] of fetchMock.mock.calls.slice(0, 2)) {
			expect(JSON.parse(String(init?.body))).toMatchObject({
				id: 501,
				fields: { PHONE: [{ VALUE: data.phone, VALUE_TYPE: "WORK" }] },
			});
		}
	});

	test("повторный отказ обновления останавливает создание сделки", async () => {
		updates = [new Error("temporary"), false];
		await expect(createBitrixContact(data)).rejects.toThrow();
		await expect(createBitrixDeal(data)).rejects.toThrow();
		expect(fetchMock.mock.calls).toHaveLength(2);
	});

	test("контакт, найденный по email, получает телефон до возврата ID", async () => {
		dialog = null;
		expect(await createBitrixContact(data)).toBe(501);
		const [, init] = fetchMock.mock.calls.at(-1) ?? [];
		expect(JSON.parse(String(init?.body))).toMatchObject({
			id: 501,
			fields: { PHONE: [{ VALUE: data.phone, VALUE_TYPE: "WORK" }] },
		});
	});

	test("отказ записи телефона в контакт, найденный по email, останавливает сделку", async () => {
		dialog = null;
		updates = [false];
		await expect(createBitrixDeal(data)).rejects.toThrow();
		expect(fetchMock.mock.calls).toHaveLength(3);
	});

	test.each([true, false])(
		"резервный путь без сделки записывает телефон контакту и возвращает %s",
		async (result) => {
			updates = [result];
			expect(
				await appendPhoneToTrackerDeal({
					messenger: "max",
					userId: 123,
					phone: data.phone,
				}),
			).toBe(result);
			expect(fetchMock.mock.calls).toHaveLength(1);
			const [url, init] = fetchMock.mock.calls[0] ?? [];
			expect(String(url)).toEndWith("/crm.contact.update.json");
			expect(JSON.parse(String(init?.body))).toEqual({
				id: 501,
				fields: { PHONE: [{ VALUE: data.phone, VALUE_TYPE: "WORK" }] },
			});
		},
	);
});
