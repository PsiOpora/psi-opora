import { describe, expect, spyOn, test } from "bun:test";
import { createLogsApi, parseLogsTsv } from "./logs-api";

type Call = { url: string; method: string };

function fakeFetch(
	responses: Array<(call: Call) => Response | undefined>,
	calls: Call[],
): typeof fetch {
	return (async (input: string | URL | Request, init?: RequestInit) => {
		const call = { url: String(input), method: init?.method ?? "GET" };
		calls.push(call);
		for (const respond of responses) {
			const res = respond(call);
			if (res) return res;
		}
		return new Response("not found", { status: 404 });
	}) as typeof fetch;
}

const json = (body: unknown) => Response.json(body);

const TSV = [
	"ym:s:visitID\tym:s:clientID\tym:s:dateTime",
	"1001\t163972457524306386\t2026-10-09 11:40:00",
	"",
].join("\n");

describe("parseLogsTsv", () => {
	test("колонки по именам полей без префикса ym:s:", () => {
		expect(parseLogsTsv(TSV)).toEqual([
			{
				visitID: "1001",
				clientID: "163972457524306386",
				dateTime: "2026-10-09 11:40:00",
			},
		]);
	});
});

describe("createLogsApi.visits", () => {
	test("создаёт запрос, ждёт готовности, скачивает части и чистит", async () => {
		const calls: Call[] = [];
		let polls = 0;
		const api = createLogsApi("12345678", "token", {
			sleep: async () => {},
			fetch: fakeFetch(
				[
					({ url }) =>
						url.includes("/logrequests/evaluate")
							? json({ log_request_evaluation: { possible: true } })
							: undefined,
					({ url, method }) =>
						url.includes("/logrequests?") && method === "POST"
							? json({ log_request: { request_id: 7, status: "created" } })
							: undefined,
					({ url }) =>
						url.endsWith("/logrequest/7")
							? json({
									log_request:
										++polls < 2
											? { request_id: 7, status: "created" }
											: {
													request_id: 7,
													status: "processed",
													parts: [{ part_number: 0, size: 10 }],
												},
								})
							: undefined,
					({ url }) =>
						url.endsWith("/logrequest/7/part/0/download")
							? new Response(TSV)
							: undefined,
					({ url }) =>
						url.endsWith("/logrequest/7/clean")
							? json({ log_request: { status: "cleaned_by_user" } })
							: undefined,
				],
				calls,
			),
		});

		const rows = await api.visits("2026-09-09", "2026-10-09");
		expect(rows).toHaveLength(1);
		const create = calls.find(
			(c) => c.method === "POST" && c.url.includes("/logrequests?"),
		);
		const params = new URL(create?.url ?? "").searchParams;
		expect(params.get("source")).toBe("visits");
		expect(params.get("date1")).toBe("2026-09-09");
		expect(params.get("fields")).toContain("ym:s:clientID");
		expect(calls.at(-1)).toMatchObject({ method: "POST" });
		expect(calls.at(-1)?.url).toEndWith("/logrequest/7/clean");
	});

	test("выгрузка невозможна (квота) — ошибка без создания запроса", async () => {
		const calls: Call[] = [];
		const api = createLogsApi("12345678", "token", {
			fetch: fakeFetch(
				[() => json({ log_request_evaluation: { possible: false } })],
				calls,
			),
		});
		await expect(api.visits("2026-09-09", "2026-10-09")).rejects.toThrow(
			"квота",
		);
		expect(calls).toHaveLength(1);
	});

	test.each([
		{ status: "created", cleanup: "cancel", cleanupStatus: 200 },
		{ status: "created", cleanup: "cancel", cleanupStatus: 500 },
		{ status: "processed", cleanup: "clean", cleanupStatus: 200 },
		{ status: "processed", cleanup: "clean", cleanupStatus: 500 },
	])(
		"при ошибке в статусе $status вызывает $cleanup (HTTP $cleanupStatus), сохраняя исходную ошибку",
		async ({ status, cleanup, cleanupStatus }) => {
			const calls: Call[] = [];
			const api = createLogsApi("12345678", "token", {
				sleep: async () => {},
				fetch: fakeFetch(
					[
						({ url }) =>
							url.includes("/logrequests/evaluate")
								? json({ log_request_evaluation: { possible: true } })
								: undefined,
						({ url }) =>
							url.includes("/logrequests?")
								? json({
										log_request: {
											request_id: 7,
											status,
											parts: [{ part_number: 0, size: 10 }],
										},
									})
								: undefined,
						({ url }) =>
							url.endsWith(`/logrequest/7/${cleanup}`)
								? new Response("cleanup", { status: cleanupStatus })
								: new Response("original failure", { status: 503 }),
					],
					calls,
				),
			});

			const failedPath =
				status === "created"
					? "/logrequest/7"
					: "/logrequest/7/part/0/download";
			await expect(api.visits("2026-09-09", "2026-10-09")).rejects.toThrow(
				`Metrika Logs API GET ${failedPath}: HTTP 503 original failure`,
			);
			expect(calls).toHaveLength(4);
			expect(calls.at(-1)).toEqual({
				url: `https://api-metrika.yandex.net/management/v1/counter/12345678/logrequest/7/${cleanup}`,
				method: "POST",
			});
		},
	);

	test("по таймауту отменяет created-запрос ровно один раз", async () => {
		const now = spyOn(Date, "now").mockReturnValue(0);
		try {
			const calls: Call[] = [];
			const api = createLogsApi("12345678", "token", {
				sleep: async () => {
					now.mockReturnValue(8 * 60 * 1000 + 1);
				},
				fetch: fakeFetch(
					[
						({ url }) =>
							url.includes("/logrequests/evaluate")
								? json({ log_request_evaluation: { possible: true } })
								: json({ log_request: { request_id: 7, status: "created" } }),
					],
					calls,
				),
			});

			await expect(api.visits("2026-09-09", "2026-10-09")).rejects.toThrow(
				"не готов за отведённое время",
			);
			expect(calls.filter((call) => call.url.endsWith("/cancel"))).toEqual([
				{
					url: "https://api-metrika.yandex.net/management/v1/counter/12345678/logrequest/7/cancel",
					method: "POST",
				},
			]);
		} finally {
			now.mockRestore();
		}
	});

	test("скачивает большую TSV-часть и сохраняет порядок строк и частей", async () => {
		const rowCount = 1_000_000;
		const largeTsv = `ym:s:visitID\n${Array.from({ length: rowCount }, (_, i) => i).join("\n")}`;
		const calls: Call[] = [];
		const api = createLogsApi("12345678", "token", {
			fetch: fakeFetch(
				[
					({ url }) =>
						url.includes("/logrequests/evaluate")
							? json({ log_request_evaluation: { possible: true } })
							: undefined,
					({ url }) =>
						url.includes("/logrequests?")
							? json({
									log_request: {
										request_id: 7,
										status: "processed",
										parts: [
											{ part_number: 0, size: largeTsv.length },
											{ part_number: 1, size: TSV.length },
										],
									},
								})
							: undefined,
					({ url }) =>
						url.endsWith("/part/0/download")
							? new Response(largeTsv)
							: undefined,
					({ url }) =>
						url.endsWith("/part/1/download") ? new Response(TSV) : json({}),
				],
				calls,
			),
		});

		const rows = await api.visits("2026-09-09", "2026-10-09");
		expect(rows).toHaveLength(rowCount + 1);
		expect(
			rows.slice(0, rowCount).every((row, i) => row.visitID === String(i)),
		).toBe(true);
		expect(rows.at(-1)?.visitID).toBe("1001");
		expect(calls.at(-1)?.url).toEndWith("/logrequest/7/clean");
	});

	test("HTTP-ошибка API пробрасывается с кодом", async () => {
		const api = createLogsApi("12345678", "token", {
			fetch: fakeFetch([() => new Response("denied", { status: 403 })], []),
		});
		await expect(api.goalNames()).rejects.toThrow("HTTP 403");
	});
});
