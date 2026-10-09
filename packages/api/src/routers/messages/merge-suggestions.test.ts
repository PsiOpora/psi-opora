import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import type { BitrixApi } from "@psi-opora/bitrix-client";
import * as queries from "@psi-opora/db/queries";
import { findMergeSuggestions } from "./merge-suggestions";

type Profile = Awaited<ReturnType<typeof queries.getBotUserProfile>>;

const profiles: Record<string, Partial<NonNullable<Profile>>> = {
	"max:2": { name: "Анна П.", username: "anna" },
	"whatsapp-personal:79991234567@c.us": { firstName: "Анна", lastName: "П" },
};

function link(messenger: string, userId: string, contactId: string) {
	return {
		id: `${messenger}:${userId}`,
		messenger,
		userId,
		contactId,
		dealId: null,
		updatedAt: new Date(),
	};
}

let groups: Record<string, queries.ClientIdentity[]>;
let dismissed: Set<string>;

beforeEach(() => {
	groups = {};
	dismissed = new Set();
	spyOn(queries, "listGroupIdentities").mockImplementation(
		async (messenger, userId) =>
			(groups[`${messenger}:${userId}`] ?? [{ messenger, userId }]) as [
				queries.ClientIdentity,
				...queries.ClientIdentity[],
			],
	);
	spyOn(queries, "resolveCanonicalIdentity").mockImplementation(
		async (messenger, userId) => ({ messenger, userId }),
	);
	spyOn(queries, "listDismissedPartnerKeys").mockImplementation(
		async () => dismissed,
	);
	spyOn(queries, "getBotUserProfile").mockImplementation(
		async (messenger, userId) =>
			(profiles[`${messenger}:${userId}`] ?? null) as Profile,
	);
	spyOn(queries, "getBitrixCrmLink").mockImplementation(
		async (messenger, userId) =>
			messenger === "telegram" && userId === "1"
				? link("telegram", "1", "42")
				: null,
	);
	spyOn(queries, "listBitrixCrmLinksByContactIds").mockImplementation(
		async (ids) =>
			[link("telegram", "1", "42"), link("max", "2", "42")].filter((l) =>
				ids.includes(l.contactId),
			),
	);
});
afterEach(() => mock.restore());

describe("findMergeSuggestions", () => {
	test("предлагает диалог, привязанный к тому же контакту CRM", async () => {
		const result = await findMergeSuggestions(null, null, "telegram", "1");
		expect(result).toEqual([
			{
				messenger: "max",
				userId: "2",
				name: "Анна П.",
				username: "anna",
				reason: "same-contact",
				phone: null,
			},
		]);
	});

	test("не предлагает каналы, уже объединённые с клиентом", async () => {
		groups["telegram:1"] = [
			{ messenger: "telegram", userId: "1" },
			{ messenger: "max", userId: "2" },
		];
		expect(await findMergeSuggestions(null, null, "telegram", "1")).toEqual([]);
	});

	test("не предлагает пару, отклонённую оператором", async () => {
		dismissed = new Set(["max:2"]);
		expect(await findMergeSuggestions(null, null, "telegram", "1")).toEqual([]);
	});

	test("отклонение действует и после слияния кандидата с другим каналом", async () => {
		// max:2 теперь secondary у max:9 — кандидат резолвится в группу max:9.
		spyOn(queries, "resolveCanonicalIdentity").mockImplementation(
			async (messenger, userId) =>
				messenger === "max" && userId === "2"
					? { messenger: "max", userId: "9" }
					: { messenger, userId },
		);
		groups["max:9"] = [
			{ messenger: "max", userId: "9" },
			{ messenger: "max", userId: "2" },
		];
		dismissed = new Set(["max:2"]);
		expect(await findMergeSuggestions(null, null, "telegram", "1")).toEqual([]);
	});

	test("находит личный WhatsApp клиента по номеру контакта CRM", async () => {
		const api = {
			call: mock(async (method: string): Promise<unknown> => {
				if (method === "crm.contact.get") {
					return {
						NAME: "Анна",
						PHONE: [{ ID: "1", VALUE: "+7 999 123-45-67" }],
					};
				}
				if (method === "crm.duplicate.findbycomm") return { CONTACT: [42] };
				throw new Error(`Unexpected CRM call: ${method}`);
			}),
		} as unknown as BitrixApi;
		spyOn(queries, "listBitrixCrmLinksByContactIds").mockResolvedValue([]);

		const result = await findMergeSuggestions(api, null, "telegram", "1");
		expect(result).toEqual([
			{
				messenger: "whatsapp-personal",
				userId: "79991234567@c.us",
				name: "Анна П",
				username: null,
				reason: "same-phone",
				phone: "+79991234567",
			},
		]);
	});

	test("без признаков (нет контакта и телефона) возвращает пустой список", async () => {
		spyOn(queries, "getBitrixCrmLink").mockResolvedValue(null);
		expect(await findMergeSuggestions(null, null, "telegram", "1")).toEqual([]);
	});
});
