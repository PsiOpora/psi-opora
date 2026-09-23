import {
	type NewAdDailyStats,
	upsertAdDailyStats,
} from "@psi-opora/db/queries";
import {
	createRedisClient,
	isRedisConfigured,
	type RedisClient,
} from "../storage/redis";

/** null, если Redis не задан (локальная разработка без Redis). */
export function getRedisOrNull(): RedisClient | null {
	return isRedisConfigured() ? createRedisClient() : null;
}

const YANDEX_TOKEN_URL = "https://oauth.yandex.ru/token";
const YANDEX_API_URL = "https://api.direct.yandex.com/json/v5";

interface YandexTokenResponse {
	access_token: string;
	expires_in: number;
}

interface YandexApiResponse {
	result?: unknown;
	error?: {
		error_code: number;
		error_string?: string;
		error_detail?: string;
	};
}

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getYandexToken(
	clientId: string,
	clientSecret: string,
	refreshToken: string,
): Promise<string> {
	if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

	const res = await fetch(YANDEX_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: clientId,
			client_secret: clientSecret,
		}),
	});
	if (!res.ok) throw new Error(`Yandex token error: ${res.status}`);

	const data = (await res.json()) as YandexTokenResponse;
	cachedToken = data.access_token;
	tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
	return cachedToken;
}

async function yandexRequest<T>(
	method: string,
	body: Record<string, unknown>,
	token: string,
	clientLogin?: string,
): Promise<T> {
	const res = await fetch(`${YANDEX_API_URL}/${method}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			...(clientLogin ? { "Client-Login": clientLogin } : {}),
		},
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`Yandex API error: ${res.status}`);

	const json = (await res.json()) as YandexApiResponse;
	if (json.error)
		throw new Error(
			`Yandex error ${json.error.error_code}: ${json.error.error_detail ?? json.error.error_string}`,
		);
	return json.result as T;
}

export interface YandexCampaign {
	Id: number;
	Name: string;
	Status: "RUNNING" | "SUSPENDED" | "ARCHIVED" | "CONVERTED";
	Type: string;
}

export interface YandexReportRow {
	CampaignId: number;
	CampaignName: string;
	Impressions: number;
	Clicks: number;
	Cost: number;
	Date: string;
}

async function getYandexCampaigns(
	token: string,
	clientLogin?: string,
): Promise<YandexCampaign[]> {
	const data = await yandexRequest<{ Campaigns: YandexCampaign[] }>(
		"campaigns",
		{
			method: "get",
			params: {
				SelectionCriteria: {},
				FieldNames: ["Id", "Name", "Status", "Type"],
			},
		},
		token,
		clientLogin,
	);
	return data.Campaigns ?? [];
}

const REPORT_FIELDS = [
	"CampaignId",
	"CampaignName",
	"Impressions",
	"Clicks",
	"Cost",
	"Date",
] as const;

/**
 * В отличие от остальных методов v5 (JSON {result: ...}/{error: ...}),
 * отчёты — отдельный формат: тело ответа при готовности — сырой TSV, не
 * JSON, а обёртки {data:{Rows:[...]}} (как раньше в этом файле) в реальном
 * API не существует — вызов всегда падал с "undefined is not an object".
 * При processingMode=auto Яндекс может не успеть посчитать отчёт сразу и
 * вернуть 201/202 с заголовком retryIn (секунды) — тогда нужно повторить
 * тот же запрос (тот же ReportName) позже; это штатное поведение API, не ошибка.
 */
async function requestYandexReportOnce(
	token: string,
	dateFrom: string,
	dateTo: string,
	reportName: string,
	clientLogin?: string,
): Promise<{ status: number; retryInSeconds: number | null; body: string }> {
	const res = await fetch(`${YANDEX_API_URL}/reports`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json; charset=utf-8",
			processingMode: "auto",
			skipReportHeader: "true",
			skipReportSummary: "true",
			...(clientLogin ? { "Client-Login": clientLogin } : {}),
		},
		body: JSON.stringify({
			params: {
				// Без фильтра по CampaignId: campaigns.get отдаёт только текущие
				// (неудалённые) кампании этого клиента, а отчёт должен видеть и
				// удалённые/архивные — иначе расход кампании, которую уже снесли в
				// кабинете, молча пропадает из ad_daily_stats задним числом. Чужие
				// кампании, которые из-за этого просачиваются через отчёт (см.
				// FOREIGN_CAMPAIGN_IDS ниже), отсеиваются точечно по ID, а не общим
				// фильтром по campaigns.get.
				SelectionCriteria: {
					DateFrom: dateFrom,
					DateTo: dateTo,
				},
				FieldNames: REPORT_FIELDS,
				ReportName: reportName,
				ReportType: "CAMPAIGN_PERFORMANCE_REPORT",
				DateRangeType: "CUSTOM_DATE",
				Format: "TSV",
				IncludeVAT: "NO",
				IncludeDiscount: "NO",
			},
		}),
	});
	const body = await res.text();
	const retryInHeader = res.headers.get("retryIn");
	return {
		status: res.status,
		retryInSeconds: retryInHeader ? Number(retryInHeader) : null,
		body,
	};
}

function parseYandexReportTsv(text: string): YandexReportRow[] {
	const lines = text.trim().split("\n").filter(Boolean);
	if (lines.length === 0) return [];
	const header = lines[0]?.split("\t") ?? [];
	const columnIndex = (name: string) => header.indexOf(name);
	const idx = {
		campaignId: columnIndex("CampaignId"),
		campaignName: columnIndex("CampaignName"),
		impressions: columnIndex("Impressions"),
		clicks: columnIndex("Clicks"),
		cost: columnIndex("Cost"),
		date: columnIndex("Date"),
	};
	return lines.slice(1).map((line) => {
		const cols = line.split("\t");
		return {
			CampaignId: Number(cols[idx.campaignId]),
			CampaignName: cols[idx.campaignName] ?? "",
			Impressions: Number(cols[idx.impressions] ?? 0),
			Clicks: Number(cols[idx.clicks] ?? 0),
			// Cost в отчёте — в микроединицах валюты (см. документацию Reports API),
			// переводим в обычные рубли здесь же, чтобы дальше по коду Cost везде
			// значил "рубли", как и предполагалось изначально.
			Cost: Number(cols[idx.cost] ?? 0) / 1_000_000,
			Date: cols[idx.date] ?? "",
		};
	});
}

const REPORT_MAX_ATTEMPTS = 6;
const REPORT_MAX_WAIT_SECONDS = 30;

async function getYandexReport(
	token: string,
	dateFrom: string,
	dateTo: string,
	clientLogin?: string,
): Promise<YandexReportRow[]> {
	const reportName = `psi-opora_${Date.now()}`;
	for (let attempt = 0; attempt < REPORT_MAX_ATTEMPTS; attempt++) {
		const { status, retryInSeconds, body } = await requestYandexReportOnce(
			token,
			dateFrom,
			dateTo,
			reportName,
			clientLogin,
		);
		if (status === 200) return parseYandexReportTsv(body);
		if (status === 201 || status === 202) {
			const waitSeconds = Math.min(
				Math.max(retryInSeconds ?? 2, 1),
				REPORT_MAX_WAIT_SECONDS,
			);
			await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
			continue;
		}
		let message = body;
		try {
			const json = JSON.parse(body) as YandexApiResponse;
			if (json.error) {
				message = `${json.error.error_code}: ${json.error.error_detail ?? json.error.error_string}`;
			}
		} catch {
			// тело не JSON — оставляем как есть для лога
		}
		throw new Error(`Yandex reports API error (${status}): ${message}`);
	}
	throw new Error(
		"Yandex reports API: отчёт не готов после нескольких попыток",
	);
}

export interface AdCampaign {
	id: string;
	name: string;
	platform: "yandex";
	status: string;
	impressions: number;
	clicks: number;
	spend: number;
	date: string;
}

export interface AdStatsResult {
	campaigns: AdCampaign[];
	totalSpend: number;
	totalImpressions: number;
	totalClicks: number;
	lastUpdated: string;
}

const CACHE_KEY = "ad_stats:live";
const CACHE_TTL = 3600;

/**
 * Кампания 713815639 ("Мастер кампании от Яндекса - Интуитивное родительство")
 * рекламирует чужой сайт (ir.academy-ei.ru, другой счётчик Метрики 106821857) —
 * не наш кабинет psi-opora. campaigns.get с текущим Client-Login её вообще не
 * отдаёт (проверено запросом с явным SelectionCriteria.Ids — кампании нет в
 * ответе), а вот CAMPAIGN_PERFORMANCE_REPORT почему-то её расход всё равно
 * возвращает — похоже, представитель имеет доступ на чтение отчётов сразу по
 * нескольким кабинетам, а не только по клиенту из Client-Login. Без этого
 * фильтра её расход молча приплюсовывался к totalSpend/ROMI на /attribution.
 */
const FOREIGN_CAMPAIGN_IDS = new Set(["713815639"]);

/**
 * dateFrom/dateTo — YYYY-MM-DD, по умолчанию последние 7 дней (как раньше).
 * Более широкое окно нужно только разовому бэкафиллу истории
 * (scripts/backfill-ads-stats.ts) — обычный крон/кнопка «Обновить» берут
 * дефолт, чтобы не упираться в лимиты API рекламных кабинетов.
 */
export async function fetchAdStats(
	redis: RedisClient | null,
	creds: {
		yandexClientId?: string | null;
		yandexClientSecret?: string | null;
		yandexRefreshToken?: string | null;
		yandexClientLogin?: string | null;
	} | null,
	dateFrom?: string,
	dateTo?: string,
): Promise<AdStatsResult> {
	const today = new Date();
	const resolvedDateTo: string =
		dateTo ?? today.toISOString().split("T")[0] ?? "";
	const resolvedDateFrom: string =
		dateFrom ??
		new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
			.toISOString()
			.split("T")[0] ??
		"";

	const campaigns: AdCampaign[] = [];
	let totalSpend = 0;
	let totalImpressions = 0;
	let totalClicks = 0;
	const dbRows: NewAdDailyStats[] = [];

	if (
		creds?.yandexClientId &&
		creds?.yandexClientSecret &&
		creds?.yandexRefreshToken
	) {
		try {
			const token = await getYandexToken(
				creds.yandexClientId,
				creds.yandexClientSecret,
				creds.yandexRefreshToken,
			);
			// getYandexCampaigns — только для статуса/подписи текущих кампаний в
			// сводке ниже; список кампаний для отчёта report сам не ограничивает
			// (см. комментарий в requestYandexReportOnce) — иначе гейт
			// "yandexCampaigns.length > 0" тоже пропустил бы отчёт целиком, если
			// в кабинете сейчас нет ни одной активной кампании.
			const clientLogin = creds.yandexClientLogin ?? undefined;
			const yandexCampaigns = await getYandexCampaigns(token, clientLogin);
			const report = await getYandexReport(
				token,
				resolvedDateFrom,
				resolvedDateTo,
				clientLogin,
			);
			for (const row of report) {
				if (FOREIGN_CAMPAIGN_IDS.has(String(row.CampaignId))) continue;
				totalSpend += row.Cost;
				totalImpressions += row.Impressions;
				totalClicks += row.Clicks;
				campaigns.push({
					id: `yandex_${row.CampaignId}`,
					name: row.CampaignName,
					platform: "yandex",
					status:
						yandexCampaigns.find((c) => c.Id === row.CampaignId)?.Status ??
						"UNKNOWN",
					impressions: row.Impressions,
					clicks: row.Clicks,
					spend: row.Cost,
					date: row.Date,
				});
				dbRows.push({
					id: `yandex_${row.CampaignId}_${row.Date}`,
					platform: "yandex",
					campaignId: String(row.CampaignId),
					campaignName: row.CampaignName,
					date: row.Date,
					impressions: row.Impressions,
					clicks: row.Clicks,
					spend: Math.round(row.Cost * 100),
				});
			}
		} catch (err) {
			console.warn("[ads] Yandex error:", (err as Error).message);
		}
	}

	if (dbRows.length > 0) {
		await upsertAdDailyStats(dbRows).catch((err) => {
			console.warn("[ads] upsertAdDailyStats error:", (err as Error).message);
		});
	}

	const result: AdStatsResult = {
		campaigns,
		totalSpend,
		totalImpressions,
		totalClicks,
		lastUpdated: new Date().toISOString(),
	};

	if (redis) {
		await redis.set(CACHE_KEY, result, { ex: CACHE_TTL });
	}

	return result;
}

export async function getCachedAdStats(
	redis: RedisClient | null,
): Promise<AdStatsResult | null> {
	if (!redis) return null;
	return redis.get<AdStatsResult>(CACHE_KEY);
}
