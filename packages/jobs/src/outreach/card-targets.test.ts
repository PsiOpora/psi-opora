import { describe, expect, it } from "bun:test";
import {
	classifyContactFields,
	type CardContact,
	type CardTargetDeps,
	maxFromCard,
	memoizeLastCardPhone,
	resolveCardTargets,
	telegramFromCard,
} from "./card-targets";
import { combineCardOutcome } from "./senders";

describe("classifyContactFields", () => {
	it("находит UF-поля Telegram и MAX по коду и подписи", () => {
		const fields = classifyContactFields({
			NAME: { title: "Имя" },
			UF_CRM_TELEGRAMID_WZ: { title: "TelegramId_WZ" },
			UF_CRM_1700: { formLabel: "Телеграм username" },
			UF_CRM_MAX_ID: { title: "MAX ID" },
			UF_CRM_MAXIMUM: { title: "Maximum score" },
			UF_CRM_OTHER: { title: "Комментарий" },
		});
		expect(fields.telegram).toEqual(["UF_CRM_TELEGRAMID_WZ", "UF_CRM_1700"]);
		expect(fields.max).toEqual(["UF_CRM_MAX_ID"]);
	});
});

describe("telegramFromCard", () => {
	it("предпочитает числовой ID из UF-поля", () => {
		const contact: CardContact = {
			UF_TG_USER: "@ivan_petrov",
			UF_TG_ID: "123456",
		};
		expect(telegramFromCard(contact, ["UF_TG_USER", "UF_TG_ID"])).toEqual({
			userId: "123456",
		});
	});

	it("берёт ID из IM-поля «Мессенджер», которое пишут наши боты", () => {
		const contact: CardContact = {
			IM: [{ VALUE: "777", VALUE_TYPE: "TELEGRAM" }],
		};
		expect(telegramFromCard(contact, [])).toEqual({ userId: "777" });
	});

	it("без ID возвращает username из ссылки t.me", () => {
		const contact: CardContact = { UF_TG: "https://t.me/ivan_petrov" };
		expect(telegramFromCard(contact, ["UF_TG"])).toEqual({
			username: "ivan_petrov",
		});
	});

	it("не принимает мусор вместо username", () => {
		expect(telegramFromCard({ UF_TG: "нет" }, ["UF_TG"])).toBeNull();
		expect(telegramFromCard({}, ["UF_TG"])).toBeNull();
	});

	it("понимает множественное UF-поле", () => {
		expect(telegramFromCard({ UF_TG: ["", "42"] }, ["UF_TG"])).toEqual({
			userId: "42",
		});
	});
});

describe("maxFromCard", () => {
	it("нужен числовой ID: username и мусор пропускаются", () => {
		expect(maxFromCard({ UF_MAX: "ivan" }, ["UF_MAX"])).toBeNull();
		expect(maxFromCard({ UF_MAX: 555 }, ["UF_MAX"])).toBe("555");
		expect(maxFromCard({ IM: [{ VALUE: "999", VALUE_TYPE: "MAX" }] }, [])).toBe(
			"999",
		);
	});
});

function deps(overrides: Partial<CardTargetDeps> = {}): CardTargetDeps {
	return {
		findContactIdsByPhone: async () => ["1"],
		getContact: async () => ({ UF_TG: "100", UF_MAX: "200" }),
		getFieldCodes: async () => ({ telegram: ["UF_TG"], max: ["UF_MAX"] }),
		...overrides,
	};
}

describe("resolveCardTargets", () => {
	it("собирает Telegram и MAX из карточки найденного по телефону контакта", async () => {
		expect(await resolveCardTargets("79991234567", deps())).toEqual({
			telegram: { userId: "100" },
			max: "200",
		});
	});

	it("досматривает дубли: Telegram в одной карточке, MAX в другой", async () => {
		const cards: Record<string, CardContact> = {
			"1": { UF_TG: "100" },
			"2": { UF_MAX: "200" },
		};
		const result = await resolveCardTargets(
			"79991234567",
			deps({
				findContactIdsByPhone: async () => ["1", "2"],
				getContact: async (id) => cards[id] ?? null,
			}),
		);
		expect(result).toEqual({ telegram: { userId: "100" }, max: "200" });
	});

	it("пустой результат, если контакта с таким телефоном нет", async () => {
		expect(
			await resolveCardTargets(
				"79991234567",
				deps({ findContactIdsByPhone: async () => [] }),
			),
		).toEqual({});
	});

	it("пустой результат без доступа к CRM", async () => {
		expect(
			await resolveCardTargets(
				"79991234567",
				deps({ findContactIdsByPhone: null }),
			),
		).toEqual({});
	});

	it("сбой CRM не бросает, а попадает в error", async () => {
		const result = await resolveCardTargets(
			"79991234567",
			deps({
				getContact: async () => {
					throw new Error("QUERY_LIMIT_EXCEEDED");
				},
			}),
		);
		expect(result.telegram).toBeUndefined();
		expect(result.error).toContain("QUERY_LIMIT_EXCEEDED");
	});
});

describe("memoizeLastCardPhone", () => {
	it("для того же телефона идёт в CRM один раз", async () => {
		let calls = 0;
		const lookup = memoizeLastCardPhone(async () => {
			calls++;
			return {};
		});
		await lookup("1");
		await lookup("1");
		await lookup("2");
		expect(calls).toBe(2);
	});
});

describe("combineCardOutcome", () => {
	const first = { kind: "not_found", error: "номера нет в MAX" } as const;

	it("успех по карточке помечается viaCard", () => {
		expect(
			combineCardOutcome(first, { kind: "sent", userId: "5", externalId: "m" }),
		).toEqual({ kind: "sent", userId: "5", externalId: "m", viaCard: true });
	});

	it("«могло уйти» и сбой канала сохраняют свой тип", () => {
		const unknown = { kind: "unknown", error: "нет подтверждения" } as const;
		const down = { kind: "channel_down", error: "воркер молчит" } as const;
		expect(combineCardOutcome(first, unknown)).toEqual(unknown);
		expect(combineCardOutcome(first, down)).toEqual(down);
	});

	it("неудача по карточке объясняет обе причины", () => {
		const outcome = combineCardOutcome(first, {
			kind: "failed",
			error: "чат не найден",
		});
		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.error).toContain("номера нет в MAX");
			expect(outcome.error).toContain("чат не найден");
		}
	});
});
