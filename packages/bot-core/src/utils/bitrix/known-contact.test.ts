import { beforeEach, describe, expect, mock, test } from "bun:test";

interface CrmLink {
	contactId: string;
	dealId: string | null;
}

let crmLink: CrmLink | null = null;
const getBitrixCrmLink = mock(() => Promise.resolve(crmLink));
mock.module("@psi-opora/db/queries", () => ({ getBitrixCrmLink }));

let contact: Record<string, unknown> | null = null;
const bitrixPost = mock((method: string) => {
	if (method === "crm.contact.get") return Promise.resolve(contact);
	return Promise.reject(new Error(`неожиданный метод в тесте: ${method}`));
});
mock.module("./client", () => ({ bitrixPost }));

interface Dialog {
	chatId: number;
	imol: string;
	contactId: number | null;
	dealId: number | null;
	leadId: number | null;
}
let dialog: Dialog | null = null;
let dialogError: Error | null = null;
const resolveOpenLineDialog = mock(() =>
	dialogError ? Promise.reject(dialogError) : Promise.resolve(dialog),
);
mock.module("./openline", () => ({ resolveOpenLineDialog }));

const { resolveKnownContact } = await import("./known-contact");

describe("resolveKnownContact", () => {
	beforeEach(() => {
		getBitrixCrmLink.mockClear();
		bitrixPost.mockClear();
		resolveOpenLineDialog.mockClear();
		crmLink = null;
		contact = null;
		dialog = null;
		dialogError = null;
	});

	test("клиент уже писал раньше (bitrix_crm_links) — подставляет имя/телефон/email, в Открытую линию не ходит", async () => {
		crmLink = { contactId: "123", dealId: "456" };
		contact = {
			NAME: "Иван Петров",
			PHONE: [{ VALUE: "+79991234567", VALUE_TYPE: "WORK" }],
			EMAIL: [{ VALUE: "  ivan@example.com  ", VALUE_TYPE: "WORK" }],
		};

		const known = await resolveKnownContact({
			messenger: "telegram",
			userId: 100,
			chatId: 100,
		});

		expect(known).toEqual({
			name: "Иван Петров",
			phone: "+79991234567",
			email: "ivan@example.com",
		});
		expect(getBitrixCrmLink).toHaveBeenCalledWith("telegram", "100");
		expect(bitrixPost).toHaveBeenCalledWith(
			"crm.contact.get",
			{ id: 123 },
			"telegram",
		);
		expect(resolveOpenLineDialog).not.toHaveBeenCalled();
	});

	test("своей записи ещё нет, но контакт уже привязан к диалогу Открытой линии", async () => {
		crmLink = null;
		dialog = {
			chatId: 5,
			imol: "imol|connector|1|100|5",
			contactId: 77,
			dealId: null,
			leadId: null,
		};
		contact = { NAME: "Мария", EMAIL: [{ VALUE: "maria@example.com" }] };

		const known = await resolveKnownContact({
			messenger: "max",
			userId: 200,
			chatId: 200,
		});

		expect(known).toEqual({
			name: "Мария",
			phone: undefined,
			email: "maria@example.com",
		});
		expect(bitrixPost).toHaveBeenCalledWith(
			"crm.contact.get",
			{ id: 77 },
			"max",
		);
	});

	test("клиента нигде нет — возвращает null, сценарий спросит данные как обычно", async () => {
		crmLink = null;
		dialog = null;

		const known = await resolveKnownContact({
			messenger: "telegram",
			userId: 300,
			chatId: 300,
		});

		expect(known).toBeNull();
		expect(bitrixPost).not.toHaveBeenCalled();
	});

	test("контакт из bitrix_crm_links оказался пустой карточкой — не запрещает поискать по диалогу", async () => {
		crmLink = { contactId: "1", dealId: null };
		contact = { NAME: "", PHONE: [], EMAIL: [] };
		dialog = {
			chatId: 5,
			imol: "imol|connector|1|100|5",
			contactId: 77,
			dealId: null,
			leadId: null,
		};

		const known = await resolveKnownContact({
			messenger: "telegram",
			userId: 100,
			chatId: 100,
		});

		// Первая карточка (id=1) без имени/телефона/email считается "не знаем" —
		// fetchKnownContact вернул бы null и для второго вызова (id=77) contact
		// остаётся тем же моком, так что тоже null.
		expect(known).toBeNull();
	});

	test("нормализует валидные поля и отбрасывает некорректные телефон и email", async () => {
		crmLink = { contactId: "1", dealId: null };
		contact = {
			NAME: "  Анна  ",
			PHONE: [{ VALUE: "+7 (999) 123-45-67" }],
			EMAIL: [{ VALUE: "не email" }],
		};

		const known = await resolveKnownContact({
			messenger: "telegram",
			userId: 100,
		});

		expect(known).toEqual({
			name: "Анна",
			phone: "+79991234567",
			email: undefined,
		});
	});

	test("не подставляет контакт, если после валидации не осталось данных", async () => {
		crmLink = { contactId: "1", dealId: null };
		contact = {
			NAME: "   ",
			PHONE: [{ VALUE: "не телефон" }],
			EMAIL: [{ VALUE: "не email" }],
		};

		const known = await resolveKnownContact({
			messenger: "telegram",
			userId: 100,
		});

		expect(known).toBeNull();
	});

	test("отметка о согласии на ПДн и её дата читаются из карточки контакта", async () => {
		crmLink = { contactId: "1", dealId: null };
		contact = {
			NAME: "Иван",
			UF_CRM_CONTACT_1779910236669: "1",
			UF_CRM_CONSENT_PDN_DT: "2026-10-17T13:00:00+03:00",
		};

		const known = await resolveKnownContact({
			messenger: "telegram",
			userId: 100,
		});

		expect(known).toEqual({
			name: "Иван",
			consentGranted: true,
			consentAt: "2026-10-17T10:00:00.000Z",
		});
	});

	test("флажок согласия без даты — согласие есть, дату не выдумываем", async () => {
		crmLink = { contactId: "1", dealId: null };
		contact = {
			UF_CRM_CONTACT_1779910236669: "1",
			UF_CRM_CONSENT_PDN_DT: "",
		};

		const known = await resolveKnownContact({
			messenger: "telegram",
			userId: 100,
		});

		expect(known?.consentGranted).toBe(true);
		expect(known?.consentAt).toBeUndefined();
	});

	test("снятый флажок согласия — контакт известен, но согласия нет", async () => {
		crmLink = { contactId: "1", dealId: null };
		contact = {
			NAME: "Иван",
			UF_CRM_CONTACT_1779910236669: "0",
			UF_CRM_CONSENT_PDN_DT: "",
		};

		const known = await resolveKnownContact({
			messenger: "telegram",
			userId: 100,
		});

		expect(known?.name).toBe("Иван");
		expect(known?.consentGranted).toBeUndefined();
	});

	test("ошибка Bitrix не ломает сценарий — просто нет данных для подстановки", async () => {
		crmLink = { contactId: "1", dealId: null };
		bitrixPost.mockImplementationOnce(() =>
			Promise.reject(new Error("TEMPORARY_ERROR")),
		);

		const known = await resolveKnownContact({
			messenger: "telegram",
			userId: 100,
			chatId: 100,
		});

		expect(known).toBeNull();
	});

	test("без chatId (например, ещё нет chatId контекста) диалог Открытой линии не запрашивается", async () => {
		crmLink = null;

		await resolveKnownContact({ messenger: "telegram", userId: 100 });

		expect(resolveOpenLineDialog).not.toHaveBeenCalled();
	});

	test("ошибка поиска диалога Открытой линии не ломает сценарий", async () => {
		dialogError = new Error("TEMPORARY_OPENLINE_ERROR");

		const known = await resolveKnownContact({
			messenger: "telegram",
			userId: 100,
			chatId: 100,
		});

		expect(known).toBeNull();
		expect(resolveOpenLineDialog).toHaveBeenCalledWith("telegram", 100, 100);
	});
});
