import { env } from "@psi-opora/config";
import type { BitrixAppName } from "./app-name";
import { forceRefreshPortalTokens, getValidPortalTokens } from "./oauth";
import { getPortalTokens } from "./tokens";

/** Cookie с memberId портала, из которой резолвится OAuth-сессия Bitrix24. */
export const MEMBER_ID_COOKIE = "b24_member_id";

export interface BitrixApi {
	/** Произвольный вызов метода REST API, возвращает "result" из ответа. */
	call<T = unknown>(
		method: string,
		params?: Record<string, unknown>,
	): Promise<T>;
	/** Полная выборка списочного метода (crm.deal.list и т.п.) с автопагинацией. */
	list<T = Record<string, unknown>>(
		method: string,
		params?: Record<string, unknown>,
		extractor?: (result: unknown) => T[],
	): Promise<T[]>;
}

interface RawResponse {
	result: unknown;
	total?: number;
	next?: number;
	error?: string;
	error_description?: string;
}

const MAX_LIST_PAGES = 400; // защита от бесконечного цикла — до 20000 записей
const MAX_RETRIES = 1;
// Bitrix24 REST лимитирует ~2 запроса/сек на приложение (leaky bucket с
// небольшим бёрстом). Пагинация больших выборок (UTM-отчёты и т.п.) плюс
// несколько параллельных цепочек запросов (deals + previousDeals + справочники,
// см. route.ts) легко выбивают этот лимит — без retry запрос падал с
// QUERY_LIMIT_EXCEEDED, а на клиенте это выглядело как зависание отчёта.
const MAX_RATE_LIMIT_RETRIES = 5;
const RATE_LIMIT_BASE_DELAY_MS = 500;

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

function isTokenError(error?: string): boolean {
	return error === "expired_token" || error === "invalid_token";
}

function isRateLimitError(error?: string): boolean {
	return error === "QUERY_LIMIT_EXCEEDED";
}

function unwrap(json: RawResponse, method: string): unknown {
	// Битрикс24 иногда отдаёт ошибку с пустой строкой в "error" (например,
	// calendar.event.add на невалидные параметры: {"error":"","error_description":"..."}).
	// Пустая строка — falsy в JS, поэтому проверяем ещё и error_description,
	// иначе такая ошибка молча превращается в json.result === undefined.
	if (json.error || json.error_description) {
		throw new Error(
			`Bitrix24 [${method}]: ${json.error || "error"} — ${json.error_description ?? ""}`,
		);
	}
	return json.result;
}

/** Разбирает ответ Bitrix24, бросая понятную ошибку вместо невнятного SyntaxError,
 * если сервер вернул не-JSON (HTML-страницу ошибки, пустое тело и т.п.). */
async function parseBitrixResponse(
	res: Response,
	method: string,
): Promise<RawResponse> {
	const text = await res.text();
	try {
		return JSON.parse(text) as RawResponse;
	} catch {
		throw new Error(
			`Bitrix24 [${method}]: некорректный ответ (HTTP ${res.status}): ${text.slice(0, 300)}`,
		);
	}
}

async function paginate<T>(
	callPage: (start: number) => Promise<RawResponse>,
	method: string,
	extractor?: (result: unknown) => T[],
): Promise<T[]> {
	const items: T[] = [];
	let start = 0;
	for (let page = 0; page < MAX_LIST_PAGES; page++) {
		const json = await callPage(start);
		const result = unwrap(json, method);
		const chunk = extractor ? extractor(result) : (result as T[]);
		items.push(...chunk);
		if (typeof json.next !== "number") return items;
		start = json.next;
	}
	throw new Error(
		`Bitrix24 [${method}]: пагинация не завершена после ${MAX_LIST_PAGES} страниц (next=${start})`,
	);
}

/** REST-клиент по OAuth-токенам локального приложения (из Redis, с автопродлением). */
export function createOAuthApi(
	memberId: string,
	app: BitrixAppName = "dashboard",
): BitrixApi {
	// Кешируем промис токенов на весь жизненный цикл этого api-инстанса (то есть
	// на один HTTP-запрос дашборда), чтобы пагинация и параллельные вызовы
	// (fetchDeals x2 + fetchSourceNames и т.п.) не долбили Redis за токенами
	// на каждую отдельную страницу/метод.
	let tokensPromise: ReturnType<typeof getValidPortalTokens> | null = null;

	function loadTokens() {
		tokensPromise ??= getValidPortalTokens(memberId, app);
		return tokensPromise;
	}

	async function request(
		method: string,
		params: Record<string, unknown>,
		start?: number,
	): Promise<RawResponse> {
		let tokenAttempt = 0;
		let rateLimitAttempt = 0;

		for (;;) {
			const tokens = await loadTokens();
			if (!tokens)
				throw new Error(
					`Нет сохранённой авторизации Bitrix24 для портала ${memberId}`,
				);

			const base = tokens.clientEndpoint.replace(/\/$/, "");
			const res = await fetch(`${base}/${method}.json`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					...params,
					...(start ? { start } : {}),
					auth: tokens.accessToken,
				}),
			});
			const json = await parseBitrixResponse(res, method);

			// Если Битрикс24 ответил, что токен протух — принудительно обновляем и
			// повторяем запрос один раз. Это защищает от clock skew и от ситуаций,
			// когда токен истёк между проверкой и фактическим вызовом.
			if (isTokenError(json.error) && tokenAttempt < MAX_RETRIES) {
				tokenAttempt++;
				tokensPromise = forceRefreshPortalTokens(memberId, app);
				await tokensPromise;
				continue;
			}

			// Bitrix24 троттлит REST по приложению (~2 запроса/сек). Пагинация
			// больших выборок легко упирается в лимит — ждём с экспоненциальным
			// бэкоффом и повторяем, вместо того чтобы сразу падать ошибкой.
			if (
				isRateLimitError(json.error) &&
				rateLimitAttempt < MAX_RATE_LIMIT_RETRIES
			) {
				rateLimitAttempt++;
				await sleep(RATE_LIMIT_BASE_DELAY_MS * 2 ** (rateLimitAttempt - 1));
				continue;
			}

			return json;
		}
	}

	return {
		async call<T>(method: string, params: Record<string, unknown> = {}) {
			const json = await request(method, params);
			return unwrap(json, method) as T;
		},
		list(method, params = {}, extractor?) {
			return paginate(
				(start) => request(method, params, start),
				method,
				extractor,
			);
		},
	};
}

/** REST-клиент по входящему вебхуку — для локальной разработки без OAuth-инсталляции. */
export function createWebhookApi(webhookUrl: string): BitrixApi {
	const base = webhookUrl.replace(/\/$/, "");

	async function request(
		method: string,
		params: Record<string, unknown>,
		start?: number,
	): Promise<RawResponse> {
		let rateLimitAttempt = 0;

		for (;;) {
			const res = await fetch(`${base}/${method}.json`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ...params, ...(start ? { start } : {}) }),
			});
			const json = await parseBitrixResponse(res, method);

			if (
				isRateLimitError(json.error) &&
				rateLimitAttempt < MAX_RATE_LIMIT_RETRIES
			) {
				rateLimitAttempt++;
				await sleep(RATE_LIMIT_BASE_DELAY_MS * 2 ** (rateLimitAttempt - 1));
				continue;
			}

			return json;
		}
	}

	return {
		async call<T>(method: string, params: Record<string, unknown> = {}) {
			const json = await request(method, params);
			return unwrap(json, method) as T;
		},
		list(method, params = {}, extractor?) {
			return paginate(
				(start) => request(method, params, start),
				method,
				extractor,
			);
		},
	};
}

// Вебхук — костыль для локальной разработки без OAuth-инсталляции портала.
// В проде (next start всегда выставляет NODE_ENV=production) фолбэк
// намеренно отключён: иначе дашборд, открытый напрямую (не из фрейма
// Битрикс24, без OAuth-сессии), отдавал бы реальные данные CRM всем подряд —
// DASHBOARD_BITRIX_WEBHOOK_URL приходит в под из общего секрета namespace.
function devWebhookUrl(): string | undefined {
	return env.NODE_ENV !== "production"
		? env.DASHBOARD_BITRIX_WEBHOOK_URL
		: undefined;
}

/**
 * Клиент Bitrix24 для записи в чужой календарь (calendar.event.add/update
 * с ownerId != вызывающий) — постоянный админский вебхук, не зависящий от
 * прав того, кто сейчас авторизовал OAuth-приложение "dashboard". Обычный
 * resolveBitrixApi() для этого не подходит: calendar.event.add проверяет
 * права именно вызывающего пользователя на календарь ownerId, а они
 * пропадают при смене роли/увольнении сотрудника, установившего приложение,
 * и рвут синк ошибкой "Доступ запрещен" независимо от прав ownerId.
 * Не гейтится NODE_ENV (в отличие от devWebhookUrl) — используется только
 * в фоновых заданиях (packages/jobs), никогда не отдаётся в браузер.
 */
export function resolveCalendarBitrixApi(): BitrixApi | null {
	const webhookUrl = env.BITRIX_CALENDAR_WEBHOOK_URL;
	return webhookUrl ? createWebhookApi(webhookUrl) : null;
}

/**
 * Клиент Bitrix24 без привязки к HTTP-запросу (для фоновых заданий):
 * по memberId — OAuth-токены портала, иначе — dev-вебхук из env.
 */
export function resolveBitrixApi(
	memberId?: string,
	app: BitrixAppName = "dashboard",
): BitrixApi | null {
	if (memberId) return createOAuthApi(memberId, app);
	const webhookUrl = devWebhookUrl();
	if (webhookUrl) return createWebhookApi(webhookUrl);
	return null;
}

/**
 * Клиент Bitrix24 для текущего запроса: сначала пробуем OAuth-сессию портала
 * (проверяя, что токены реально сохранены — иначе `memberId` из устаревшей
 * cookie привёл бы к ошибке вместо честного фолбэка), иначе — вебхук для
 * локальной разработки (DASHBOARD_BITRIX_WEBHOOK_URL в .env, только вне
 * прода).
 */
export async function resolveBitrixApiForRequest(
	memberId: string | null,
	app: BitrixAppName = "dashboard",
): Promise<BitrixApi | null> {
	if (memberId) {
		const tokens = await getPortalTokens(memberId, app);
		if (tokens) return createOAuthApi(memberId, app);
	}
	const webhookUrl = devWebhookUrl();
	if (webhookUrl) return createWebhookApi(webhookUrl);
	return null;
}
