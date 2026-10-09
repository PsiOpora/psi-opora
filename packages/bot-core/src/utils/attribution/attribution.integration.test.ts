import { afterAll, beforeAll, describe, expect, test } from "bun:test";

// Сквозной тест «касание с сайта → сделка в Bitrix»: реальная БД с
// миграциями, поддельные Bitrix (локальный HTTP) и API Директа (подмена fetch).
//   ATTRIBUTION_TEST_DATABASE_URL=postgres://… bun test attribution.integration
const url = process.env.ATTRIBUTION_TEST_DATABASE_URL;

// biome-ignore lint/suspicious/noExplicitAny: тело запроса к поддельному Bitrix в тесте произвольное
type BitrixBody = Record<string, any>;

interface BitrixCall {
	method: string;
	body: BitrixBody;
}

describe.skipIf(!url)("касания → сделка Bitrix (сквозной)", () => {
	const bitrixCalls: BitrixCall[] = [];
	let bitrixServer: ReturnType<typeof Bun.serve>;
	const realFetch = globalThis.fetch;
	let queries: typeof import("@psi-opora/db/queries");
	let submitConsultationDeal: typeof import("../consultation-deal").submitConsultationDeal;

	const CLIENT_ID = String(Math.floor(Math.random() * 1e15) + 1e17);
	const NEW_CLIENT_ID = String(Math.floor(Math.random() * 1e15) + 1e17);
	const directMethods: string[] = [];

	const dealFields = () =>
		bitrixCalls.filter((c) => c.method === "crm.deal.add").at(-1)?.body.fields;

	beforeAll(async () => {
		process.env.POSTGRES_URL = url;
		bitrixServer = Bun.serve({
			port: 0,
			async fetch(req) {
				const method =
					new URL(req.url).pathname.split("/").pop()?.replace(".json", "") ??
					"";
				bitrixCalls.push({
					method,
					body: (await req.json()) as BitrixBody,
				});
				const result: Record<string, unknown> = {
					"crm.duplicate.findbycomm": {},
					"crm.contact.add": 501,
					"crm.deal.add": 9001,
					"crm.timeline.comment.add": 77,
				};
				return Response.json({ result: result[method] ?? true });
			},
		});
		process.env.TG_BITRIX_WEBHOOK_URL = `http://127.0.0.1:${bitrixServer.port}/rest/1/hook`;
		process.env.TG_BITRIX_SOURCE_ID = "TG_SRC";
		process.env.TG_BOT_ID = "main_tg_bot";

		// API Директа: OAuth и методы справочника — подмена; остальное (в том
		// числе локальный «Bitrix») идёт настоящим fetch.
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const target = String(input);
			if (target.includes("oauth.yandex.ru")) {
				return Response.json({ access_token: "t", expires_in: 3600 });
			}
			if (target.includes("api.direct.yandex.com")) {
				const method = target.split("/").pop() ?? "";
				directMethods.push(method);
				const results: Record<string, unknown> = {
					campaigns: {
						Campaigns: [{ Id: 708811857, Name: "Анорексия — поиск" }],
					},
					adgroups: {
						AdGroups: [{ Id: 5600000111, Name: "Лечение анорексии" }],
					},
					ads: {
						Ads: [
							{ Id: 17000000123, TextAd: { Title: "Помощь при анорексии" } },
						],
					},
					keywords: {
						Keywords: [{ Id: 1234567890, Keyword: "лечение анорексии" }],
					},
				};
				return Response.json({ result: results[method] });
			}
			return realFetch(input, init);
		}) as typeof fetch;

		queries = await import("@psi-opora/db/queries");
		({ submitConsultationDeal } = await import("../consultation-deal"));
		await queries.upsertAdCredentials({
			yandexClientId: "id",
			yandexClientSecret: "secret",
			yandexRefreshToken: "refresh",
			yandexClientLogin: null,
		});
	});

	afterAll(() => {
		globalThis.fetch = realFetch;
		bitrixServer?.stop(true);
	});

	test("цепочка из двух касаний превращается в UTM, описание и комментарий в таймлайне", async () => {
		const { normalizeTouchPayload, touchPayloadSchema } = await import(
			"./touch"
		);
		const visit = (extra: Record<string, unknown>, offsetMin: number) => {
			const touch = normalizeTouchPayload(
				touchPayloadSchema.parse({ clientId: CLIENT_ID, ...extra }),
				new Date(Date.now() - offsetMin * 60_000),
			);
			if (!touch) throw new Error("касание не распознано");
			return queries.insertAdTouch(touch);
		};
		// Первое касание — давно, из другой кампании; последнее — по объявлению.
		await visit(
			{
				utm_source: "yandex",
				utm_medium: "cpc",
				utm_campaign: "rsya_retarget_anorexia_v2",
			},
			60 * 24 * 5,
		);
		await visit(
			{
				utm_source: "yandex",
				utm_medium: "cpc",
				utm_campaign: "search_anorexia_708811857",
				utm_content: "17000000123",
				utm_term: "лечение анорексии",
				gbid: "5600000111",
				phrase_id: "1234567890",
				landingUrl: "https://psi-opora.ru/anorexia/",
			},
			30,
		);

		const dealId = await submitConsultationDeal({
			name: "Анна",
			phone: "+79990000000",
			messenger: "telegram",
			source: "psi-opora.ru",
			campaign: "main_banner",
			ymClientId: CLIENT_ID,
			flow: "consult",
		});
		expect(dealId).toBe(9001);

		expect(dealFields()).toMatchObject({
			UTM_SOURCE: "yandex",
			UTM_MEDIUM: "cpc",
			UTM_CAMPAIGN: "search_anorexia_708811857",
			UTM_CONTENT: "Помощь при анорексии (17000000123)",
			UTM_TERM: "лечение анорексии",
			SOURCE_DESCRIPTION:
				"Яндекс.Директ · РК «Анорексия — поиск» · группа «Лечение анорексии» · объявление «Помощь при анорексии» (17000000123) · ключ «лечение анорексии»",
			// тема расстройства проставилась по названию кампании
			UF_CRM_1779041362411: ["46"],
		});
		expect(dealFields().COMMENTS).toContain("Касаний с рекламой: 2");

		const timeline = bitrixCalls.find(
			(c) => c.method === "crm.timeline.comment.add",
		);
		expect(timeline?.body.fields).toMatchObject({
			ENTITY_ID: 9001,
			ENTITY_TYPE: "deal",
		});
		expect(timeline?.body.fields.COMMENT).toContain(
			"Касания с рекламой до заявки (2):",
		);
		expect(timeline?.body.fields.COMMENT).toContain(
			"rsya_retarget_anorexia_v2",
		);
		expect(timeline?.body.fields.COMMENT).toContain(
			"Страница: https://psi-opora.ru/anorexia/",
		);

		// снимок касаний сохранён за сделкой
		expect(await queries.listDealTouchIds("9001")).toHaveLength(2);
	});

	test("названия закэшированы: второй раз Директ не опрашивается", async () => {
		const callsBefore = directMethods.length;
		expect(callsBefore).toBe(4);

		const { normalizeTouchPayload, touchPayloadSchema } = await import(
			"./touch"
		);
		const touch = normalizeTouchPayload(
			touchPayloadSchema.parse({
				clientId: NEW_CLIENT_ID,
				utm_source: "yandex",
				utm_campaign: "708811857",
				utm_content: "17000000123",
				gbid: "5600000111",
			}),
		);
		if (!touch) throw new Error("касание не распознано");
		await queries.insertAdTouch(touch);

		await submitConsultationDeal({
			name: "Борис",
			phone: "+79990000001",
			messenger: "telegram",
			ymClientId: NEW_CLIENT_ID,
			flow: "consult",
		});

		expect(directMethods.length).toBe(callsBefore);
		expect(dealFields()).toMatchObject({
			UTM_CAMPAIGN: "708811857",
			SOURCE_DESCRIPTION: expect.stringContaining("РК «Анорексия — поиск»"),
		});
	});

	test("клиент без касаний — сделка по старой схеме, комментария в таймлайн нет", async () => {
		const timelineBefore = bitrixCalls.filter(
			(c) => c.method === "crm.timeline.comment.add",
		).length;

		await submitConsultationDeal({
			name: "Вера",
			phone: "+79990000002",
			messenger: "telegram",
			source: "psi-opora.ru",
			campaign: "main_banner",
			ymClientId: String(Math.floor(Math.random() * 1e15) + 1e17),
			flow: "consult",
		});

		expect(dealFields()).toMatchObject({
			UTM_SOURCE: "psi-opora.ru",
			UTM_MEDIUM: "telegram_bot",
			UTM_CAMPAIGN: "main_banner",
			UTM_CONTENT: "main_tg_bot",
		});
		expect(
			bitrixCalls.filter((c) => c.method === "crm.timeline.comment.add"),
		).toHaveLength(timelineBefore);
	});

	test("Директ недоступен — сделка всё равно создаётся, в описании ID", async () => {
		const failingClient = String(Math.floor(Math.random() * 1e15) + 1e17);
		const { normalizeTouchPayload, touchPayloadSchema } = await import(
			"./touch"
		);
		const touch = normalizeTouchPayload(
			touchPayloadSchema.parse({
				clientId: failingClient,
				utm_source: "yandex",
				utm_campaign: "999999999",
				utm_content: "88888888888",
			}),
		);
		if (!touch) throw new Error("касание не распознано");
		await queries.insertAdTouch(touch);

		const fetchWithDirect = globalThis.fetch;
		globalThis.fetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			if (String(input).includes("api.direct.yandex.com")) {
				return new Response("down", { status: 503 });
			}
			return fetchWithDirect(input, init);
		}) as typeof fetch;
		try {
			const dealId = await submitConsultationDeal({
				name: "Глеб",
				phone: "+79990000003",
				messenger: "telegram",
				ymClientId: failingClient,
				flow: "consult",
			});
			expect(dealId).toBe(9001);
		} finally {
			globalThis.fetch = fetchWithDirect;
		}
		expect(dealFields().SOURCE_DESCRIPTION).toBe(
			"Яндекс · РК 999999999 · объявление 88888888888",
		);
	});
});
