import { beforeEach, describe, expect, mock, test } from "bun:test";

const calls: string[] = [];

const getBotUserProfile = mock(() => Promise.resolve(null));
mock.module("@psi-opora/db/queries", () => ({
	getBotUserProfile,
	getYandexMetrikaSettings: () => Promise.resolve(null),
	saveYandexMetrikaDealVisitor: () => Promise.resolve(),
}));

let attributionError: Error | null = null;
const resolveDealAttribution = mock(() => {
	calls.push("attribution");
	return attributionError
		? Promise.reject(attributionError)
		: Promise.resolve(null);
});
mock.module("./attribution/deal-attribution", () => ({
	resolveDealAttribution,
	recordDealAttribution: () => Promise.resolve(),
}));

let contactError: Error | null = null;
const createBitrixContact = mock((_data: unknown) => {
	calls.push("contact");
	return contactError ? Promise.reject(contactError) : Promise.resolve(501);
});
let dealResult: { contactId: number; dealId: number } = {
	contactId: 501,
	dealId: 77,
};
let dealError: Error | null = null;
const createBitrixDeal = mock((_data: unknown, _existingContactId?: number) => {
	calls.push("deal");
	return dealError ? Promise.reject(dealError) : Promise.resolve(dealResult);
});
const appendPhoneToTrackerDeal = mock((_params: unknown) =>
	Promise.resolve(true),
);
mock.module("./bitrix", () => ({
	createBitrixContact,
	createBitrixDeal,
	appendPhoneToTrackerDeal,
}));

mock.module("./funnel", () => ({ trackFunnelStep: () => Promise.resolve() }));

const { submitConsultationDeal } = await import("./consultation-deal");

const params = {
	name: "Светлана",
	phone: "9109084657",
	messenger: "max",
	userId: 49043323,
	chatId: 49043323,
	flow: "book_preorder" as const,
};

describe("submitConsultationDeal", () => {
	beforeEach(() => {
		calls.length = 0;
		createBitrixContact.mockClear();
		createBitrixDeal.mockClear();
		appendPhoneToTrackerDeal.mockClear();
		contactError = null;
		dealError = null;
		attributionError = null;
		dealResult = { contactId: 501, dealId: 77 };
	});

	test("телефон пишется в контакт отдельным шагом до атрибуции и сделки", async () => {
		const dealId = await submitConsultationDeal(params);

		expect(dealId).toBe(77);
		expect(calls).toEqual(["contact", "attribution", "deal"]);
		const contact = createBitrixContact.mock.calls[0]?.[0] as {
			phone: string;
		};
		expect(contact.phone).toBe("9109084657");
		// Сделка получает уже готовый контакт — второй раз его не создаёт.
		expect(createBitrixDeal.mock.calls[0]?.[1]).toBe(501);
		expect(appendPhoneToTrackerDeal).not.toHaveBeenCalled();
	});

	test("сбой атрибуции: контакт с телефоном уже сохранён, номер уходит в сделку трекера", async () => {
		attributionError = new Error("db упала");

		const dealId = await submitConsultationDeal(params);

		expect(dealId).toBeNull();
		expect(createBitrixContact).toHaveBeenCalledTimes(1);
		expect(createBitrixDeal).not.toHaveBeenCalled();
		expect(appendPhoneToTrackerDeal).toHaveBeenCalledWith({
			messenger: "max",
			userId: 49043323,
			chatId: 49043323,
			phone: "9109084657",
		});
	});

	test("сбой создания сделки — номер уходит комментарием в сделку трекера", async () => {
		dealError = new Error("crm.deal.add упал");

		const dealId = await submitConsultationDeal(params);

		expect(dealId).toBeNull();
		expect(appendPhoneToTrackerDeal).toHaveBeenCalledTimes(1);
	});

	test("Bitrix вернул dealId=0 без исключения — тоже запасной путь", async () => {
		dealResult = { contactId: 0, dealId: 0 };

		const dealId = await submitConsultationDeal(params);

		expect(dealId).toBeNull();
		expect(appendPhoneToTrackerDeal).toHaveBeenCalledTimes(1);
	});

	test("сбой сохранения контакта не мешает создать сделку (контакт создаст createBitrixDeal)", async () => {
		contactError = new Error("crm.contact.update упал");

		const dealId = await submitConsultationDeal(params);

		expect(dealId).toBe(77);
		expect(createBitrixDeal.mock.calls[0]?.[1]).toBeUndefined();
		expect(appendPhoneToTrackerDeal).not.toHaveBeenCalled();
	});
});
