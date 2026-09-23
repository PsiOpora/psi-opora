import { describe, expect, test } from "bun:test";
import {
	normalizePhoneDigits,
	parseMessageSenderForm,
} from "../src/message-sender-payload";

function form(fields: Record<string, string>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.set(key, value);
	return data;
}

const base = {
	type: "SMS",
	code: "psiopora_wa_personal",
	message_id: "65575980fa531ac284c2ee68f81ebebd",
	message_to: "+7 (999) 123-45-67",
	message_body: "Здравствуйте!",
	"auth[member_id]": "abc123",
	"auth[application_token]": "token",
};

describe("parseMessageSenderForm", () => {
	test("разбирает поля и привязки CRM", () => {
		const payload = parseMessageSenderForm(
			form({
				...base,
				module_id: "crm",
				"bindings[0][OWNER_TYPE_ID]": "2",
				"bindings[0][OWNER_ID]": "15",
				"bindings[1][OWNER_TYPE_ID]": "3",
				"bindings[1][OWNER_ID]": "42",
			}),
		);
		expect(payload).toEqual({
			code: "psiopora_wa_personal",
			messageId: "65575980fa531ac284c2ee68f81ebebd",
			to: "+7 (999) 123-45-67",
			text: "Здравствуйте!",
			memberId: "abc123",
			contactId: "42",
			dealId: "15",
		});
	});

	test("берёт номер и текст из properties, если основных полей нет", () => {
		const { message_to: _to, message_body: _body, ...rest } = base;
		const payload = parseMessageSenderForm(
			form({
				...rest,
				"properties[phone_number]": "89991234567",
				"properties[message_text]": "Текст",
			}),
		);
		expect(payload?.to).toBe("89991234567");
		expect(payload?.text).toBe("Текст");
	});

	test("отклоняет чужой код провайдера и пустой текст", () => {
		expect(parseMessageSenderForm(form({ ...base, code: "other" }))).toBeNull();
		expect(
			parseMessageSenderForm(form({ ...base, message_body: "   " })),
		).toBeNull();
	});
});

describe("normalizePhoneDigits", () => {
	test("приводит российские номера к 7XXXXXXXXXX", () => {
		expect(normalizePhoneDigits("+7 (999) 123-45-67")).toBe("79991234567");
		expect(normalizePhoneDigits("8 999 123 45 67")).toBe("79991234567");
		expect(normalizePhoneDigits("9991234567")).toBe("79991234567");
	});

	test("оставляет международные номера и отклоняет мусор", () => {
		expect(normalizePhoneDigits("+375 29 123-45-67")).toBe("375291234567");
		expect(normalizePhoneDigits("  +999 123 45 67 ")).toBe("9991234567");
		expect(normalizePhoneDigits("+8 999 123 45 67")).toBe("89991234567");
		expect(normalizePhoneDigits("123")).toBeNull();
	});
});
