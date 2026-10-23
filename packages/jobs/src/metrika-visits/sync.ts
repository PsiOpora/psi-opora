import {
	getYandexMetrikaSettings,
	listDealVisitorsForVisitSummary,
	markDealVisitsSummarized,
} from "@psi-opora/db/queries";
import { createLogsApi } from "./logs-api";
import {
	type SiteVisit,
	summarizeVisits,
	toSiteVisit,
	VISITS_LOOKBACK_DAYS,
} from "./summary";

const DAY_MS = 24 * 60 * 60 * 1000;
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
/** Сделки старше этого срока не догоняем — сводка нужна, пока сделка в работе. */
const MAX_DEAL_AGE_DAYS = 14;

/** Минимум от BitrixApi: вызов REST-метода портала. */
export interface BitrixCaller {
	call(method: string, params: Record<string, unknown>): Promise<unknown>;
}

type LogsApi = ReturnType<typeof createLogsApi>;

export interface VisitSummariesResult {
	[key: string]: number | boolean;
	skipped: boolean;
	deals: number;
	done: number;
	noVisits: number;
	failed: number;
	visitRows: number;
}

/** Дата по Москве (YYYY-MM-DD). */
function mskDate(time: number): string {
	return new Date(time + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

/** Начало текущих суток по Москве. */
function mskDayStart(now: Date): number {
	return Date.parse(`${mskDate(now.getTime())}T00:00:00Z`) - MSK_OFFSET_MS;
}

async function writeSummary(
	bitrix: BitrixCaller,
	dealId: string,
	fields: Record<string, string>,
	timelineComment: string,
): Promise<void> {
	if (Object.keys(fields).length > 0) {
		await bitrix.call("crm.deal.update", { id: dealId, fields });
	}
	await bitrix.call("crm.timeline.comment.add", {
		fields: {
			ENTITY_ID: Number(dealId),
			ENTITY_TYPE: "deal",
			COMMENT: timelineComment,
		},
	});
}

/**
 * Дописывает в сделки сводку визитов клиента на сайт до заявки по данным
 * Logs API Метрики: число визитов, первый визит и его источник, город,
 * устройство, страницы, время, достигнутые цели — в поля сделки (коды из
 * /settings/metrika) и подробно в таймлайн. Logs API не отдаёт текущий день,
 * поэтому сделка обрабатывается на следующий день после создания, один раз.
 * Фильтра по ClientID у Logs API нет: выгружается весь счётчик за окно
 * визитов и сопоставляется со сделками здесь, без сохранения чужих визитов.
 */
export async function syncDealVisitSummaries(
	bitrix: BitrixCaller,
	now: Date = new Date(),
	deps: { logsApi?: (counterId: string, token: string) => LogsApi } = {},
): Promise<VisitSummariesResult> {
	const result: VisitSummariesResult = {
		skipped: false,
		deals: 0,
		done: 0,
		noVisits: 0,
		failed: 0,
		visitRows: 0,
	};
	const settings = await getYandexMetrikaSettings();
	if (!settings?.counterId || !settings.oauthToken) {
		return { ...result, skipped: true };
	}

	const todayStart = mskDayStart(now);
	const deals = await listDealVisitorsForVisitSummary(
		new Date(todayStart - MAX_DEAL_AGE_DAYS * DAY_MS),
		new Date(todayStart),
	);
	result.deals = deals.length;
	const oldest = deals[0];
	if (!oldest) return result;

	const api = (deps.logsApi ?? createLogsApi)(
		settings.counterId,
		settings.oauthToken,
	);
	const [rows, goalNames] = await Promise.all([
		api.visits(
			mskDate(oldest.createdAt.getTime() - VISITS_LOOKBACK_DAYS * DAY_MS),
			mskDate(todayStart - 1),
		),
		api.goalNames().catch((err: Error) => {
			console.warn(
				`[metrika-visits] не удалось получить названия целей: ${err.message}`,
			);
			return new Map<string, string>();
		}),
	]);
	result.visitRows = rows.length;

	const wanted = new Set(deals.map((deal) => deal.clientId));
	const visitsByClient = new Map<string, SiteVisit[]>();
	for (const row of rows) {
		if (!wanted.has(row.clientID ?? "")) continue;
		const visit = toSiteVisit(row);
		if (!visit) continue;
		visitsByClient.set(visit.clientId, [
			...(visitsByClient.get(visit.clientId) ?? []),
			visit,
		]);
	}

	const fieldCodes = settings.bitrixVisitDealFields ?? {};
	for (const deal of deals) {
		const summary = summarizeVisits(
			visitsByClient.get(deal.clientId) ?? [],
			deal.createdAt,
			goalNames,
		);
		try {
			if (!summary) {
				await markDealVisitsSummarized(deal.dealId, "no_visits");
				result.noVisits++;
				continue;
			}
			const fields = Object.fromEntries(
				Object.entries(summary.fields).flatMap(([key, value]) => {
					const code = fieldCodes[key as keyof typeof fieldCodes];
					return code && value ? [[code, value]] : [];
				}),
			);
			await writeSummary(bitrix, deal.dealId, fields, summary.timelineComment);
			await markDealVisitsSummarized(deal.dealId, "done");
			result.done++;
		} catch (err) {
			result.failed++;
			console.error(
				`[metrika-visits] не удалось записать визиты в сделку ${deal.dealId}: ${(err as Error).message}`,
			);
		}
	}
	return result;
}
