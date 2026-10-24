const API_BASE = "https://api-metrika.yandex.net/management/v1/counter";
const POLL_INTERVAL_MS = 15_000;
const MAX_WAIT_MS = 8 * 60 * 1000;

/** Поля визита, которые выгружает крон; `last` — источник самого визита. */
export const VISIT_FIELDS = [
	"ym:s:visitID",
	"ym:s:clientID",
	"ym:s:dateTime",
	"ym:s:startURL",
	"ym:s:endURL",
	"ym:s:pageViews",
	"ym:s:visitDuration",
	"ym:s:bounce",
	"ym:s:regionCity",
	"ym:s:regionCountry",
	"ym:s:deviceCategory",
	"ym:s:operatingSystemRoot",
	"ym:s:browser",
	"ym:s:lastTrafficSource",
	"ym:s:lastAdvEngine",
	"ym:s:lastSearchEngineRoot",
	"ym:s:lastReferalSource",
	"ym:s:lastUTMSource",
	"ym:s:lastUTMMedium",
	"ym:s:lastUTMCampaign",
	"ym:s:lastUTMContent",
	"ym:s:lastUTMTerm",
	"ym:s:goalsID",
	// Клик по объявлению Директа, приведший к визиту: ID и названия
	// кампании/группы/объявления, условие показа и тип площадки.
	"ym:s:lastDirectClickOrder",
	"ym:s:lastDirectClickOrderName",
	"ym:s:lastDirectBannerGroup",
	"ym:s:lastClickBannerGroupName",
	"ym:s:lastDirectClickBanner",
	"ym:s:lastDirectClickBannerName",
	"ym:s:lastDirectPhraseOrCond",
	"ym:s:lastDirectPlatformType",
] as const;

/** Строка выгрузки: значение колонки по имени поля без префикса ym:s:. */
export type LogsVisitRow = Record<string, string>;

export interface LogsApiDeps {
	fetch?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
}

interface LogRequest {
	request_id: number;
	status: string;
	parts?: Array<{ part_number: number; size: number }>;
}

function sleepMs(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Клиент Logs API одного счётчика: выгрузка асинхронная — создать запрос,
 * дождаться статуса processed, скачать части TSV, очистить. Очистка
 * обязательна: подготовленные файлы занимают общую квоту 10 ГБ на счётчик.
 * Данные за текущий день Logs API не отдаёт — date2 не позже вчера.
 */
export function createLogsApi(
	counterId: string,
	token: string,
	deps: LogsApiDeps = {},
) {
	const fetchFn = deps.fetch ?? fetch;
	const sleep = deps.sleep ?? sleepMs;
	const base = `${API_BASE}/${encodeURIComponent(counterId)}`;

	async function request(path: string, method = "GET"): Promise<Response> {
		const res = await fetchFn(`${base}${path}`, {
			method,
			headers: { Authorization: `OAuth ${token}` },
		});
		if (!res.ok) {
			const body = await res.text().catch(() => "");
			throw new Error(
				`Metrika Logs API ${method} ${path.split("?")[0]}: HTTP ${res.status} ${body.slice(0, 300)}`,
			);
		}
		return res;
	}

	async function json<T>(path: string, method = "GET"): Promise<T> {
		return (await (await request(path, method)).json()) as T;
	}

	/** Названия целей счётчика по их номерам — для читаемой сводки. */
	async function goalNames(): Promise<Map<string, string>> {
		const data = await json<{ goals?: Array<{ id: number; name: string }> }>(
			"/goals",
		);
		return new Map((data.goals ?? []).map((g) => [String(g.id), g.name]));
	}

	/** Визиты за период [date1, date2] (YYYY-MM-DD) всего счётчика. */
	async function visits(date1: string, date2: string): Promise<LogsVisitRow[]> {
		const query = new URLSearchParams({
			date1,
			date2,
			source: "visits",
			fields: VISIT_FIELDS.join(","),
		}).toString();

		const evaluation = await json<{
			log_request_evaluation?: { possible?: boolean };
		}>(`/logrequests/evaluate?${query}`);
		if (!evaluation.log_request_evaluation?.possible) {
			throw new Error(
				`Metrika Logs API: выгрузка за ${date1}…${date2} сейчас невозможна (квота)`,
			);
		}

		let logRequest = (
			await json<{ log_request: LogRequest }>(`/logrequests?${query}`, "POST")
		).log_request;
		const id = logRequest.request_id;
		const startedAt = Date.now();
		try {
			while (logRequest.status !== "processed") {
				if (logRequest.status !== "created") {
					throw new Error(
						`Metrika Logs API: запрос ${id} в статусе ${logRequest.status}`,
					);
				}
				if (Date.now() - startedAt > MAX_WAIT_MS) {
					throw new Error(
						`Metrika Logs API: запрос ${id} не готов за отведённое время`,
					);
				}
				await sleep(POLL_INTERVAL_MS);
				logRequest = (
					await json<{ log_request: LogRequest }>(`/logrequest/${id}`)
				).log_request;
			}

			const rows: LogsVisitRow[] = [];
			for (const part of logRequest.parts ?? []) {
				const text = await (
					await request(`/logrequest/${id}/part/${part.part_number}/download`)
				).text();
				for (const row of parseLogsTsv(text)) {
					rows.push(row);
				}
			}
			await request(`/logrequest/${id}/clean`, "POST");
			return rows;
		} catch (err) {
			// Готовые, но не скачанные файлы тоже занимают квоту.
			if (logRequest.status === "processed") {
				await request(`/logrequest/${id}/clean`, "POST").catch(() => {});
			} else if (logRequest.status === "created") {
				await request(`/logrequest/${id}/cancel`, "POST").catch(() => {});
			}
			throw err;
		}
	}

	return { goalNames, visits };
}

export function parseLogsTsv(text: string): LogsVisitRow[] {
	const lines = text.split("\n").filter((line) => line.trim() !== "");
	const header = (lines[0] ?? "")
		.split("\t")
		.map((name) => name.trim().replace(/^ym:s:/, ""));
	return lines.slice(1).map((line) => {
		const cols = line.split("\t");
		return Object.fromEntries(
			header.map((name, index) => [name, (cols[index] ?? "").trim()]),
		);
	});
}
