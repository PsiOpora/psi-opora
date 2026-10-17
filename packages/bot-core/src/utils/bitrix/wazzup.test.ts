import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("@psi-opora/db/queries", () => ({
	getBitrixCrmLink: () => Promise.resolve(null),
	upsertBitrixCrmLink: () => Promise.resolve(),
	getYandexMetrikaSettings: () => Promise.resolve(null),
}));
mock.module("@psi-opora/config", () => ({
	bitrixPortalKey: () => "portal",
}));
mock.module("./openline", () => ({
	resolveOpenLineDialog: () => Promise.resolve(null),
}));

let contactRows: unknown[] = [];
let dealRows: unknown[] = [];
let wazzupContact: Record<string, unknown> = {};
const bitrixPost = mock((method: string, _body?: unknown) => {
	if (method === "crm.contact.list") return Promise.resolve(contactRows);
	if (method === "crm.deal.list") return Promise.resolve(dealRows);
	if (method === "crm.contact.get") return Promise.resolve(wazzupContact);
	if (method === "crm.deal.add") return Promise.resolve(777);
	if (method === "crm.contact.add") return Promise.resolve(888);
	return Promise.resolve(true);
});
mock.module("./client", () => ({
	bitrixPost,
	getBotId: () => "max-bot",
	getEnv: () => "https://example.bitrix24.ru/rest/1/x/",
	getSourceId: () => "BOT_MAX",
	getSourceName: () => "MAX-бот",
	getWebhookBase: () => "https://example.bitrix24.ru/rest/1/x/",
}));

const {
	adoptWazzupDeal,
	buildWazzupContactUpdate,
	canAdoptWazzupDeal,
	findWazzupClient,
} = await import("./wazzup");
const { createBitrixDeal } = await import("./create-deal");

const WZ_SOURCE = "WZe041cb12-8166-4580-a1b2-b7aecd550ac2";

const data = {
	name: "Дарья",
	phone: "89825551220",
	email: "Daria@Example.test",
	consentGranted: true,
	messenger: "max",
	telegramUserId: 17509641,
	chatId: 17509641,
	flow: "consult" as const,
};

const wazzupDeal = {
	id: 6124,
	categoryId: 0,
	stageId: "NEW",
	title: "Сделка по обращению в Max (17509641)",
	comments: "[p]Спрашивала про цены[/p]",
};

function calls(method: string) {
	return bitrixPost.mock.calls.filter((c) => c[0] === method);
}

function body(method: string) {
	return calls(method)[0]?.[1] as {
		id: number;
		fields: Record<string, unknown>;
	};
}

beforeEach(() => {
	bitrixPost.mockClear();
	contactRows = [];
	dealRows = [];
	wazzupContact = { NAME: "Дарья", PHONE: null, EMAIL: null, IM: null };
});

describe("findWazzupClient", () => {
	test("сверяет UF-поле сам: Bitrix игнорирует фильтр по полю, которого нет на портале", async () => {
		contactRows = [{ ID: "1" }, { ID: "2", UF_CRM_MAXID_WZ: "999" }];
		expect(await findWazzupClient("max", 17509641)).toBeNull();
		expect(calls("crm.deal.list")).toHaveLength(0);
	});

	test("берёт контакт открытой сделки Wazzup, а не наш старый контакт", async () => {
		contactRows = [
			{ ID: "8216", UF_CRM_MAXID_WZ: "17509641" },
			{ ID: "8250", UF_CRM_MAXID_WZ: "17509641" },
		];
		dealRows = [
			{
				ID: "6130",
				CONTACT_ID: "8216",
				CATEGORY_ID: "0",
				STAGE_ID: "NEW",
				SOURCE_ID: "BOT_MAX",
			},
			{
				ID: "6124",
				CONTACT_ID: "8250",
				CATEGORY_ID: "0",
				STAGE_ID: "UC_WWIO8W",
				SOURCE_ID: WZ_SOURCE,
				TITLE: "Сделка по обращению в Max (17509641)",
				COMMENTS: null,
			},
		];
		const client = await findWazzupClient("max", 17509641);
		expect(client?.contactId).toBe(8250);
		expect(client?.deal).toMatchObject({
			id: 6124,
			categoryId: 0,
			stageId: "UC_WWIO8W",
			comments: "",
		});
		expect(body("crm.deal.list")).toMatchObject({
			filter: { CONTACT_ID: [8216, 8250], CLOSED: "N" },
		});
	});

	test("без открытой сделки Wazzup — самый старый контакт", async () => {
		contactRows = [
			{ ID: "8214", UF_CRM_MAXID_WZ: "17509641" },
			{ ID: "8216", UF_CRM_MAXID_WZ: "17509641" },
		];
		expect(await findWazzupClient("max", 17509641)).toEqual({
			contactId: 8214,
			deal: null,
		});
	});

	test("Telegram ищется по UF_CRM_TELEGRAMID_WZ, у прочих каналов поиска нет", async () => {
		await findWazzupClient("telegram", 305714910);
		expect(body("crm.contact.list")).toMatchObject({
			filter: { UF_CRM_TELEGRAMID_WZ: "305714910" },
		});
		bitrixPost.mockClear();
		expect(await findWazzupClient("whatsapp", 1)).toBeNull();
		expect(bitrixPost).not.toHaveBeenCalled();
	});

	test("сбой Bitrix — null, бот работает со своей карточкой", async () => {
		bitrixPost.mockImplementationOnce(() =>
			Promise.reject(new Error("QUERY_LIMIT")),
		);
		expect(await findWazzupClient("max", 17509641)).toBeNull();
	});
});

describe("buildWazzupContactUpdate", () => {
	test("дописывает телефон, email, согласие и привязку мессенджера, имя не трогает", () => {
		const fields = buildWazzupContactUpdate(
			{ ...data, consentAt: "2026-10-17T10:00:00Z" },
			{ NAME: "Дарья Владимировна" },
		);
		expect(fields).toEqual({
			PHONE: [{ VALUE: data.phone, VALUE_TYPE: "WORK" }],
			EMAIL: [{ VALUE: data.email, VALUE_TYPE: "WORK" }],
			UF_CRM_CONTACT_1779910236669: 1,
			UF_CRM_CONTACT_CONSENT_PDN_DT: "2026-10-17T10:00:00Z",
			IM: [{ VALUE: "17509641", VALUE_TYPE: "max" }],
		});
	});

	test("не дублирует уже записанные телефон (8… = +7…), email и привязку", () => {
		const fields = buildWazzupContactUpdate(data, {
			NAME: "Дарья",
			PHONE: [{ VALUE: "+7 982 555-12-20" }],
			EMAIL: [{ VALUE: "daria@example.test" }],
			IM: [{ VALUE: "17509641" }],
		});
		expect(fields).toEqual({ UF_CRM_CONTACT_1779910236669: 1 });
	});

	test("пустое имя в карточке заполняет именем из бота", () => {
		expect(buildWazzupContactUpdate(data, { NAME: " " }).NAME).toBe("Дарья");
	});
});

describe("canAdoptWazzupDeal", () => {
	const preorder = {
		...data,
		flow: "book_preorder" as const,
		categoryId: 8,
		stageId: "C8:NEW",
	};

	test.each([
		[
			"заявка без своей воронки — любая открытая сделка",
			wazzupDeal,
			data,
			true,
		],
		[
			"разобранная менеджером сделка — тоже",
			{ ...wazzupDeal, stageId: "UC_WWIO8W" },
			data,
			true,
		],
		[
			"сделку уже занимала прошлая заявка",
			{ ...wazzupDeal, comments: "Бот: max-bot\n[p]…" },
			data,
			false,
		],
		["предзаказ: неразобранная сделка переносится", wazzupDeal, preorder, true],
		[
			"предзаказ: сделка уже в его воронке",
			{ ...wazzupDeal, categoryId: 8, stageId: "C8:UC_0HJ3ZP" },
			preorder,
			true,
		],
		[
			"предзаказ: менеджер уже ведёт сделку по другому продукту",
			{ ...wazzupDeal, stageId: "PREPAYMENT_INVOICE" },
			preorder,
			false,
		],
	])("%s", (_name, deal, dealData, expected) => {
		expect(canAdoptWazzupDeal(deal, dealData)).toBe(expected);
	});
});

describe("adoptWazzupDeal", () => {
	const fields = {
		TITLE: "Заявка (Консультация, max-bot): Дарья",
		CONTACT_IDS: [8252],
		ASSIGNED_BY_ID: 18,
		CATEGORY_ID: 8,
		STAGE_ID: "C8:NEW",
		SOURCE_ID: "BOT_MAX",
		UTM_SOURCE: "yandex",
		COMMENTS: "Бот: max-bot\nmax user_id: 17509641",
	} as never;

	test("стадию, ответственного и контакты не трогает, заметки менеджера сохраняет", async () => {
		expect(
			await adoptWazzupDeal(
				{ ...wazzupDeal, stageId: "UC_WWIO8W" },
				fields,
				data,
				"max",
			),
		).toBe(6124);
		expect(calls("crm.item.update")).toHaveLength(0);
		expect(body("crm.deal.update")).toEqual({
			id: 6124,
			fields: {
				TITLE: "Заявка (Консультация, max-bot): Дарья",
				SOURCE_ID: "BOT_MAX",
				UTM_SOURCE: "yandex",
				COMMENTS:
					"Бот: max-bot\nmax user_id: 17509641\n\n[p]Спрашивала про цены[/p]",
			},
		});
	});

	test("название, которое дал менеджер, не перезаписывает", async () => {
		await adoptWazzupDeal(
			{ ...wazzupDeal, title: "Дарья — дочь 14 лет" },
			fields,
			data,
			"max",
		);
		expect(body("crm.deal.update").fields).not.toHaveProperty("TITLE");
	});

	test("предзаказ переносит неразобранную сделку в свою воронку через crm.item.update", async () => {
		const preorder = {
			...data,
			flow: "book_preorder" as const,
			categoryId: 8,
			stageId: "C8:NEW",
		};
		await adoptWazzupDeal(wazzupDeal, fields, preorder, "max");
		expect(body("crm.item.update")).toEqual({
			entityTypeId: 2,
			id: 6124,
			fields: { categoryId: 8, stageId: "C8:NEW" },
		} as never);
	});

	test("сбой Bitrix — null, чтобы заявка ушла в новую сделку", async () => {
		bitrixPost.mockImplementationOnce(() =>
			Promise.reject(new Error("ACCESS_DENIED")),
		);
		expect(await adoptWazzupDeal(wazzupDeal, fields, data, "max")).toBeNull();
	});
});

describe("createBitrixDeal с карточкой Wazzup", () => {
	test("пишет телефон и почту в контакт Wazzup и заявку в его сделку, своих не заводит", async () => {
		contactRows = [{ ID: "8250", UF_CRM_MAXID_WZ: "17509641" }];
		dealRows = [
			{
				ID: "6124",
				CONTACT_ID: "8250",
				CATEGORY_ID: "0",
				STAGE_ID: "UC_WWIO8W",
				SOURCE_ID: WZ_SOURCE,
				TITLE: wazzupDeal.title,
				COMMENTS: null,
			},
		];
		expect(await createBitrixDeal(data)).toEqual({
			contactId: 8250,
			dealId: 6124,
		});
		expect(calls("crm.contact.add")).toHaveLength(0);
		expect(calls("crm.deal.add")).toHaveLength(0);
		expect(body("crm.contact.update")).toMatchObject({
			id: 8250,
			fields: {
				PHONE: [{ VALUE: data.phone }],
				EMAIL: [{ VALUE: data.email }],
			},
		});
		expect(body("crm.deal.update").id).toBe(6124);
	});

	test("сделка Wazzup уже занята прошлой заявкой — новая сделка на контакт Wazzup", async () => {
		contactRows = [{ ID: "8250", UF_CRM_MAXID_WZ: "17509641" }];
		dealRows = [
			{
				ID: "6124",
				CONTACT_ID: "8250",
				CATEGORY_ID: "0",
				STAGE_ID: "UC_WWIO8W",
				SOURCE_ID: WZ_SOURCE,
				COMMENTS: "Бот: max-bot",
			},
		];
		expect(await createBitrixDeal(data)).toEqual({
			contactId: 8250,
			dealId: 777,
		});
		expect(body("crm.deal.add").fields.CONTACT_IDS).toEqual([8250]);
	});

	test("без карточки Wazzup — как раньше, свой контакт и сделка", async () => {
		expect(await createBitrixDeal(data)).toEqual({
			contactId: 888,
			dealId: 777,
		});
	});
});
