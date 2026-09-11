import { describe, expect, it } from "bun:test";
import { extractContactPhone, resolveDirectBotTarget } from "./shared";

describe("resolveDirectBotTarget", () => {
	it("выбирает Telegram ID контакта для значения 328 в сделке", () => {
		expect(
			resolveDirectBotTarget(
				{ UF_CRM_1779643796551: "328" },
				{ IM: [{ VALUE_TYPE: "telegram", VALUE: "5652886641" }] },
			),
		).toEqual({ messenger: "telegram", userId: "5652886641" });
	});

	it("выбирает MAX ID контакта для значения 326 в сделке", () => {
		expect(
			resolveDirectBotTarget(
				{ UF_CRM_1779643796551: "326" },
				{
					IM: [
						{ VALUE_TYPE: "telegram", VALUE: "111" },
						{ VALUE_TYPE: "IMOL|MAX", VALUE: "222" },
					],
				},
			),
		).toEqual({ messenger: "max", userId: "222" });
	});

	it("использует первый валидный бот-ID, если мессенджер сделки не задан", () => {
		expect(
			resolveDirectBotTarget(
				{},
				{
					IM: [{ VALUE_TYPE: "IMOL|TELEGRAM", VALUE: "333" }],
				},
			),
		).toEqual({ messenger: "telegram", userId: "333" });
	});

	it("не принимает пустые и нечисловые идентификаторы", () => {
		expect(
			resolveDirectBotTarget(
				{ UF_CRM_1779643796551: "328" },
				{ IM: [{ VALUE_TYPE: "telegram", VALUE: "@username" }] },
			),
		).toBeNull();
	});
});

describe("extractContactPhone", () => {
	it("возвращает телефон контакта для резолва WhatsApp-получателя", () => {
		expect(extractContactPhone({ PHONE: [{ VALUE: "+79219612671" }] })).toBe(
			"+79219612671",
		);
	});

	it("возвращает null без контакта или без телефона", () => {
		expect(extractContactPhone(false)).toBeNull();
		expect(extractContactPhone({})).toBeNull();
		expect(extractContactPhone({ PHONE: [{ VALUE: "" }] })).toBeNull();
	});
});
