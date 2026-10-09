import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fetchYandexEntityNames } from "./ad-directory";

const creds = {
	yandexClientId: "id",
	yandexClientSecret: "secret",
	yandexRefreshToken: "refresh",
	yandexClientLogin: "psi-opora-client",
};

const refs = {
	campaignIds: ["708811857"],
	groupIds: ["5600000111"],
	adIds: ["17000000123"],
	keywordIds: ["1234567890"],
};

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; headers: Headers; body: unknown }> = [];

/** Подмена fetch: токен OAuth + ответы методов Директа v5. */
function mockDirect(
	responses: Record<string, unknown | (() => Response)>,
): void {
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (url.includes("oauth.yandex.ru")) {
			return Response.json({ access_token: "token", expires_in: 3600 });
		}
		const method = url.split("/").pop() ?? "";
		calls.push({
			url,
			headers: new Headers(init?.headers),
			body: JSON.parse(String(init?.body)),
		});
		const response = responses[method];
		if (typeof response === "function") return (response as () => Response)();
		return Response.json({ result: response });
	}) as typeof fetch;
}

beforeEach(() => {
	calls = [];
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("fetchYandexEntityNames", () => {
	test("забирает названия кампании, группы, объявления и ключа", async () => {
		mockDirect({
			campaigns: { Campaigns: [{ Id: 708811857, Name: "Анорексия — поиск" }] },
			adgroups: { AdGroups: [{ Id: 5600000111, Name: "Лечение анорексии" }] },
			ads: {
				Ads: [
					{
						Id: 17000000123,
						TextAd: { Title: "Помощь при анорексии", Title2: "Психолог" },
					},
				],
			},
			keywords: {
				Keywords: [{ Id: 1234567890, Keyword: "лечение анорексии" }],
			},
		});

		const entities = await fetchYandexEntityNames(creds, refs);

		expect(entities).toEqual(
			expect.arrayContaining([
				{
					platform: "yandex",
					kind: "campaign",
					externalId: "708811857",
					name: "Анорексия — поиск",
				},
				{
					platform: "yandex",
					kind: "group",
					externalId: "5600000111",
					name: "Лечение анорексии",
				},
				{
					platform: "yandex",
					kind: "ad",
					externalId: "17000000123",
					name: "Помощь при анорексии | Психолог",
				},
				{
					platform: "yandex",
					kind: "keyword",
					externalId: "1234567890",
					name: "лечение анорексии",
				},
			]),
		);
		expect(entities).toHaveLength(4);
	});

	test("запрашивает нужные поля по ID и передаёт Client-Login", async () => {
		mockDirect({ campaigns: {}, adgroups: {}, ads: {}, keywords: {} });
		await fetchYandexEntityNames(creds, refs);

		const byMethod = Object.fromEntries(
			calls.map((c) => [c.url.split("/").pop(), c]),
		);
		expect(byMethod.ads?.body).toEqual({
			method: "get",
			params: {
				SelectionCriteria: { Ids: [17000000123] },
				FieldNames: ["Id"],
				TextAdFieldNames: ["Title", "Title2"],
			},
		});
		expect(byMethod.keywords?.body).toMatchObject({
			params: { SelectionCriteria: { Ids: [1234567890] } },
		});
		for (const call of calls) {
			expect(call.headers.get("client-login")).toBe("psi-opora-client");
			expect(call.headers.get("authorization")).toBe("Bearer token");
		}
	});

	test("сбой одного метода не отнимает названия остальных", async () => {
		mockDirect({
			campaigns: { Campaigns: [{ Id: 708811857, Name: "Анорексия — поиск" }] },
			adgroups: () => new Response("boom", { status: 500 }),
			ads: { Ads: [] },
			keywords: { Keywords: [] },
		});

		const entities = await fetchYandexEntityNames(creds, refs);

		expect(entities).toEqual([
			{
				platform: "yandex",
				kind: "campaign",
				externalId: "708811857",
				name: "Анорексия — поиск",
			},
		]);
	});

	test("не спрашивает у API виды сущностей, ID которых нет", async () => {
		mockDirect({ campaigns: { Campaigns: [] } });
		await fetchYandexEntityNames(creds, {
			campaignIds: ["708811857"],
			groupIds: [],
			adIds: [],
			keywordIds: [],
		});
		expect(calls.map((c) => c.url.split("/").pop())).toEqual(["campaigns"]);
	});

	test("объявление без заголовка (не текстовое) не даёт названия", async () => {
		mockDirect({ ads: { Ads: [{ Id: 17000000123 }] } });
		const entities = await fetchYandexEntityNames(creds, {
			campaignIds: [],
			groupIds: [],
			adIds: ["17000000123"],
			keywordIds: [],
		});
		expect(entities).toEqual([]);
	});

	test("без учётных данных Директа ничего не запрашивает", async () => {
		mockDirect({});
		const entities = await fetchYandexEntityNames(
			{ ...creds, yandexRefreshToken: null },
			refs,
		);
		expect(entities).toEqual([]);
		expect(calls).toHaveLength(0);
	});
});
