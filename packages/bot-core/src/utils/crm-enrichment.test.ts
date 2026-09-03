import { beforeEach, describe, expect, mock, test } from "bun:test";

const generateObject = mock(() =>
	Promise.resolve({
		object: {
			name: null,
			phone: null,
			email: null,
			city: null,
			usefulSummary: null,
		},
	}),
);
mock.module("ai", () => ({ generateObject }));

mock.module("@psi-opora/config", () => ({
	env: { OPENROUTER_API_KEY: "test-key", OPENROUTER_MODEL: "test-model" },
	logger: {
		error: mock(() => {}),
		info: mock(() => {}),
		warn: mock(() => {}),
	},
}));

mock.module("@openrouter/ai-sdk-provider", () => ({
	createOpenRouter: () => ({
		chat: (name: string) => ({ modelId: name }),
	}),
}));

let contact: Record<string, unknown> = {
	NAME: "Марина",
	PHONE: [{ VALUE: "89680388189" }],
};
let crmLink: {
	contactId: string;
	dealId: string | null;
} | null = { contactId: "7624", dealId: "5336" };
const getBitrixCrmLink = mock(() => Promise.resolve(crmLink));
mock.module("@psi-opora/db/queries", () => ({
	getBitrixCrmLink,
	getYandexMetrikaSettings: () => Promise.resolve(null),
}));

const createBitrixContact = mock(() => Promise.resolve(9001));
mock.module("./bitrix/create-deal", () => ({ createBitrixContact }));

const bitrixPost = mock((method: string) => {
	if (method === "crm.contact.get") return Promise.resolve(contact);
	return Promise.resolve(true);
});
mock.module("./bitrix/client", () => ({ bitrixPost }));

const appendDealComment = mock(() => Promise.resolve());
mock.module("./bitrix/sources", () => ({ appendDealComment }));

const { enrichCrmFromClientMessage } = await import("./crm-enrichment");

describe("enrichCrmFromClientMessage", () => {
	beforeEach(() => {
		generateObject.mockClear();
		getBitrixCrmLink.mockClear();
		bitrixPost.mockClear();
		appendDealComment.mockClear();
		createBitrixContact.mockClear();
		crmLink = { contactId: "7624", dealId: "5336" };
		contact = {
			NAME: "Марина",
			PHONE: [{ VALUE: "89680388189" }],
		};
	});

	test("добавляет поздний email без вызова LLM", async () => {
		await enrichCrmFromClientMessage({
			messenger: "max",
			userId: "32263492",
			text: "pronina9@yandex.ru",
		});

		expect(generateObject).not.toHaveBeenCalled();
		expect(bitrixPost).toHaveBeenCalledWith(
			"crm.contact.update",
			{
				id: 7624,
				fields: {
					EMAIL: [{ VALUE: "pronina9@yandex.ru", VALUE_TYPE: "WORK" }],
				},
			},
			"max",
		);
	});

	test("создаёт и привязывает контакт по телефону вне сценария", async () => {
		crmLink = null;
		contact = {
			NAME: "Екатерина",
			PHONE: [{ VALUE: "+79095775055" }],
		};

		await enrichCrmFromClientMessage({
			messenger: "max",
			userId: "124364923",
			text: "+79095775055",
			name: "Екатерина",
			chatId: 124364923,
			source: "search",
			campaign: "anorexia",
		});

		expect(createBitrixContact).toHaveBeenCalledWith({
			name: "Екатерина",
			phone: "+79095775055",
			email: undefined,
			consentGranted: false,
			messenger: "max",
			telegramUserId: 124364923,
			chatId: 124364923,
			source: "search",
			campaign: "anorexia",
		});
		expect(generateObject).not.toHaveBeenCalled();
	});

	test("создаёт контакт, когда телефон указан внутри фразы", async () => {
		crmLink = null;

		await enrichCrmFromClientMessage({
			messenger: "telegram",
			userId: "777",
			text: "Мой телефон +7 (999) 123-45-67",
			name: "Анна",
		});

		expect(createBitrixContact).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "Анна",
				phone: "+7 (999) 123-45-67",
				consentGranted: false,
				telegramUserId: 777,
			}),
		);
	});

	test("не перезаписывает уже заполненный email", async () => {
		contact = {
			...contact,
			EMAIL: [{ VALUE: "saved@example.com" }],
		};

		await enrichCrmFromClientMessage({
			messenger: "max",
			userId: "32263492",
			text: "new@example.com",
		});

		const updateCalls = bitrixPost.mock.calls.filter(
			([method]) => method === "crm.contact.update",
		);
		expect(updateCalls).toHaveLength(0);
	});

	test("при таймауте LLM сохраняет очевидный email из текста", async () => {
		generateObject.mockImplementationOnce(() =>
			Promise.reject(
				new DOMException("The operation timed out.", "TimeoutError"),
			),
		);

		await enrichCrmFromClientMessage({
			messenger: "max",
			userId: "32263492",
			text: "Моя почта для связи: client@example.com",
		});

		expect(bitrixPost).toHaveBeenCalledWith(
			"crm.contact.update",
			{
				id: 7624,
				fields: {
					EMAIL: [{ VALUE: "client@example.com", VALUE_TYPE: "WORK" }],
				},
			},
			"max",
		);
	});

	test("не падает, если контакт удалён в Bitrix", async () => {
		contact = undefined as unknown as Record<string, unknown>;

		await expect(
			enrichCrmFromClientMessage({
				messenger: "max",
				userId: "32263492",
				text: "pronina9@yandex.ru",
			}),
		).resolves.toBeUndefined();

		const updateCalls = bitrixPost.mock.calls.filter(
			([method]) => method === "crm.contact.update",
		);
		expect(updateCalls).toHaveLength(0);
	});

	test("после таймаута основной модели использует fallback", async () => {
		generateObject
			.mockImplementationOnce(() =>
				Promise.reject(
					new DOMException("The operation timed out.", "TimeoutError"),
				),
			)
			.mockImplementationOnce(() =>
				Promise.resolve({
					object: {
						name: null,
						phone: null,
						email: null,
						city: "Казань",
						usefulSummary: null,
					},
				}),
			);

		await enrichCrmFromClientMessage({
			messenger: "max",
			userId: "32263492",
			text: "Я живу в Казани и ищу очную консультацию",
		});

		expect(generateObject).toHaveBeenCalledTimes(2);
		expect(generateObject.mock.calls[1]?.[0].model).toEqual({
			modelId: "inclusionai/ling-3.0-flash:free",
		});
		expect(bitrixPost).toHaveBeenCalledWith(
			"crm.contact.update",
			{ id: 7624, fields: { ADDRESS_CITY: "Казань" } },
			"max",
		);
	});
});
