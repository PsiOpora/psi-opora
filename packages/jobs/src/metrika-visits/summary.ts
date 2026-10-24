import type { VisitDealFieldKey } from "@psi-opora/db/queries";
import { type AdClick, parseAdClick } from "./ad-click";
import type { LogsVisitRow } from "./logs-api";

/** Визит клиента в удобном для сводки виде. */
export interface SiteVisit {
	visitId: string;
	clientId: string;
	startedAt: Date;
	startUrl: string;
	pageViews: number;
	durationSeconds: number;
	bounce: boolean;
	city: string;
	device: string;
	source: string;
	goalIds: string[];
	/** Клик по объявлению Директа, если визит начался с него. */
	adClick?: AdClick;
}

/** Визиты до заявки за это окно объясняют путь клиента; старше — уже шум. */
export const VISITS_LOOKBACK_DAYS = 30;
/** В таймлайн — последние визиты перед заявкой. */
const MAX_TIMELINE_VISITS = 15;

const DEVICE_LABELS: Record<string, string> = {
	"1": "компьютер",
	"2": "смартфон",
	"3": "планшет",
	"4": "телевизор",
};

const TRAFFIC_SOURCE_LABELS: Record<string, string> = {
	ad: "реклама",
	organic: "поиск",
	direct: "прямой заход",
	referral: "переход с сайта",
	internal: "внутренний переход",
	social: "соцсети",
	email: "почта",
	messenger: "мессенджер",
	recommend: "рекомендации",
	saved: "сохранённые страницы",
	undefined: "не определён",
};

const ADV_ENGINE_LABELS: Record<string, string> = {
	ya_direct: "Яндекс.Директ",
	ya_undefined: "Яндекс",
	google_adwords: "Google Ads",
	vkontakte: "ВКонтакте",
	mytarget: "myTarget",
};

const MSK_DATE = new Intl.DateTimeFormat("ru-RU", {
	timeZone: "Europe/Moscow",
	day: "2-digit",
	month: "2-digit",
	year: "numeric",
});
const MSK_DATE_TIME = new Intl.DateTimeFormat("ru-RU", {
	timeZone: "Europe/Moscow",
	day: "2-digit",
	month: "2-digit",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
});

/** «Реклама (Яндекс.Директ, utm_campaign …)», «поиск (yandex)», «переход с сайта (vk.com)». */
function describeSource(row: LogsVisitRow): string {
	const kind = row.lastTrafficSource ?? "";
	const label = TRAFFIC_SOURCE_LABELS[kind] ?? (kind || "не определён");
	const details: string[] = [];
	if (kind === "ad") {
		const engine = row.lastAdvEngine ?? "";
		if (engine) details.push(ADV_ENGINE_LABELS[engine] ?? engine);
	} else if (kind === "organic" && row.lastSearchEngineRoot) {
		details.push(row.lastSearchEngineRoot);
	} else if (
		(kind === "referral" || kind === "social") &&
		row.lastReferalSource
	) {
		details.push(row.lastReferalSource);
	}
	if (row.lastUTMCampaign) details.push(`кампания ${row.lastUTMCampaign}`);
	else if (row.lastUTMSource) details.push(`utm ${row.lastUTMSource}`);
	return details.length ? `${label} (${details.join(", ")})` : label;
}

/** goalsID приходит как "[123,456]". */
function parseGoalIds(value: string | undefined): string[] {
	return (value ?? "")
		.replace(/[[\]\s]/g, "")
		.split(",")
		.filter((id) => /^\d+$/.test(id));
}

/**
 * dateTime — в часовом поясе счётчика; счётчик сайта — по Москве.
 * Невалидная дата — null, такой визит пропускается.
 */
function parseMskDateTime(value: string | undefined): Date | null {
	if (!value || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
		return null;
	}
	const date = new Date(`${value.replace(" ", "T")}+03:00`);
	return Number.isNaN(date.getTime()) ? null : date;
}

export function toSiteVisit(row: LogsVisitRow): SiteVisit | null {
	const startedAt = parseMskDateTime(row.dateTime);
	if (!startedAt || !row.clientID || !row.visitID) return null;
	const adClick = parseAdClick(row);
	const device = [
		DEVICE_LABELS[row.deviceCategory ?? ""],
		row.operatingSystemRoot,
		row.browser,
	]
		.filter(Boolean)
		.join(" · ");
	return {
		visitId: row.visitID,
		clientId: row.clientID,
		startedAt,
		startUrl: row.startURL ?? "",
		pageViews: Number(row.pageViews) || 0,
		durationSeconds: Number(row.visitDuration) || 0,
		bounce: row.bounce === "1",
		city: row.regionCity ?? "",
		device,
		source: describeSource(row),
		goalIds: parseGoalIds(row.goalsID),
		...(adClick ? { adClick } : {}),
	};
}

export function formatDuration(totalSeconds: number): string {
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes === 0) return `${seconds} с`;
	return seconds ? `${minutes} мин ${seconds} с` : `${minutes} мин`;
}

export interface VisitSummary {
	fields: Partial<Record<VisitDealFieldKey, string>>;
	timelineComment: string;
}

/**
 * Визиты, начавшиеся не позже создания сделки и не раньше
 * VISITS_LOOKBACK_DAYS до неё, без дублей, от старых к новым.
 */
export function visitsBeforeDeal(
	visits: SiteVisit[],
	dealCreatedAt: Date,
): SiteVisit[] {
	const since =
		dealCreatedAt.getTime() - VISITS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
	const unique = new Map<string, SiteVisit>();
	for (const visit of visits) {
		const time = visit.startedAt.getTime();
		if (time >= since && time <= dealCreatedAt.getTime()) {
			unique.set(visit.visitId, visit);
		}
	}
	return [...unique.values()].sort(
		(a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
	);
}

export type AdVisit = SiteVisit & { adClick: AdClick };

/** Последний визит с клика по Директу перед заявкой — им объясняется реклама сделки. */
export function lastAdVisit(sorted: SiteVisit[]): AdVisit | undefined {
	return sorted
		.filter((visit): visit is AdVisit => Boolean(visit.adClick))
		.at(-1);
}

/** Сводка по визитам до заявки (см. visitsBeforeDeal); null — визитов нет. */
export function summarizeVisits(
	sorted: SiteVisit[],
	goalNames: Map<string, string>,
): VisitSummary | null {
	const first = sorted[0];
	const last = sorted.at(-1);
	if (!first || !last) return null;

	const pageViews = sorted.reduce((sum, v) => sum + v.pageViews, 0);
	const duration = sorted.reduce((sum, v) => sum + v.durationSeconds, 0);
	const goalName = (id: string) => goalNames.get(id) ?? `цель ${id}`;
	const goals = [...new Set(sorted.flatMap((v) => v.goalIds))].map(goalName);

	const values: Partial<Record<VisitDealFieldKey, string>> = {
		visitCount: String(sorted.length),
		firstVisitAt: MSK_DATE.format(first.startedAt),
		firstSource: first.source,
		pageViews: String(pageViews),
		timeOnSite: formatDuration(duration),
		...(last.city ? { city: last.city } : {}),
		...(last.device ? { device: last.device } : {}),
		...(goals.length ? { goals: goals.join(", ") } : {}),
	};

	const shown = sorted.slice(-MAX_TIMELINE_VISITS);
	const lines = [
		`Визиты на сайт до заявки (Метрика): ${sorted.length}, первый — ${MSK_DATE.format(first.startedAt)}, всего ${pageViews} стр. и ${formatDuration(duration)}`,
		...(sorted.length > shown.length
			? [`Показаны последние ${shown.length}:`]
			: []),
		...shown.map((visit, index) => {
			const parts = [
				`${sorted.length - shown.length + index + 1}. ${MSK_DATE_TIME.format(visit.startedAt)} МСК — ${visit.source}`,
				visit.bounce
					? "отказ"
					: `${visit.pageViews} стр., ${formatDuration(visit.durationSeconds)}`,
				...(visit.city ? [visit.city] : []),
				...(visit.device ? [visit.device] : []),
				...(visit.goalIds.length
					? [`цели: ${visit.goalIds.map(goalName).join(", ")}`]
					: []),
			];
			return [
				parts.join(" · "),
				...(visit.startUrl ? [`   Вход: ${visit.startUrl}`] : []),
			].join("\n");
		}),
	];
	return { fields: values, timelineComment: lines.join("\n") };
}
