import { formatClickPosition } from "@psi-opora/bot-core";
import type { AdDealFieldKey } from "@psi-opora/db/queries";
import type { LogsVisitRow } from "./logs-api";

/**
 * Клик по объявлению Директа, с которого начался визит. ID и названия
 * кампании/группы/объявления Метрика отдаёт сама (Logs API), а позицию и
 * регион показа — только если они есть в адресе входа: шаблон «Параметры
 * URL» в Директе добавляет их макросами {position}, {position_type},
 * {region_name}, а startURL хранит полный адрес со строкой запроса.
 */
export interface AdClick {
	campaignId?: string;
	campaignName?: string;
	groupId?: string;
	groupName?: string;
	adId?: string;
	adName?: string;
	/** Условие показа: ключевая фраза, автотаргетинг и т. п. */
	condition?: string;
	/** ID ключевой фразы из {phrase_id} — уточняет поисковый запрос. */
	keywordId?: string;
	platformType?: string;
	position?: string;
	positionType?: string;
	regionName?: string;
	/** Страница входа без строки запроса и якоря. */
	landingPage?: string;
	/** UTM-метки визита (Метрика) — для меток сделки, если бот своих не знал. */
	utmCampaign?: string;
	utmContent?: string;
	utmTerm?: string;
}

const ID_RE = /^\d{5,20}$/;
/** Тот же числовой хвост метки, что в dashboard ad-spend-match: ID кампании. */
const TRAILING_ID_RE = /(\d{6,20})$/;

/** Числовые UInt-поля Logs API без значения приходят как "0". */
function idOf(value: string | null | undefined): string | undefined {
	const text = value?.trim();
	return text && ID_RE.test(text) ? text : undefined;
}

function textOf(value: string | null | undefined): string | undefined {
	const text = value?.trim();
	// Нераскрытый макрос ({position}) — не значение.
	return text && !/\{[^}]*\}/.test(text) ? text : undefined;
}

function parseUrl(value: string | undefined): URL | undefined {
	if (!value) return undefined;
	try {
		return new URL(value);
	} catch {
		return undefined;
	}
}

/** Клик из Директа или undefined, если визит пришёл не с объявления Директа. */
export function parseAdClick(row: LogsVisitRow): AdClick | undefined {
	const url = parseUrl(row.startURL);
	const param = (name: string) => textOf(url?.searchParams.get(name));

	const campaignId =
		idOf(row.lastDirectClickOrder) ??
		idOf(param("campaign_id")) ??
		param("utm_campaign")?.match(TRAILING_ID_RE)?.[1];
	const groupId = idOf(row.lastDirectBannerGroup) ?? idOf(param("gbid"));
	const fromDirect =
		row.lastTrafficSource === "ad" &&
		(row.lastAdvEngine ?? "").startsWith("ya_");
	if (!fromDirect && !idOf(row.lastDirectClickOrder) && !groupId) {
		return undefined;
	}

	const click: AdClick = {
		campaignId,
		campaignName: textOf(row.lastDirectClickOrderName),
		groupId,
		groupName: textOf(row.lastClickBannerGroupName),
		adId:
			idOf(row.lastDirectClickBanner) ??
			idOf(param("ad_id")) ??
			idOf(param("utm_content")),
		adName: textOf(row.lastDirectClickBannerName),
		condition: textOf(row.lastDirectPhraseOrCond) ?? textOf(row.lastUTMTerm),
		keywordId: idOf(param("phrase_id")),
		platformType: textOf(row.lastDirectPlatformType),
		position: param("position"),
		positionType: param("position_type"),
		// В шаблонах кампаний регион показа передаётся и как region_name, и как region.
		regionName: param("region_name") ?? param("region"),
		landingPage: url ? `${url.origin}${url.pathname}` : undefined,
		utmCampaign: textOf(row.lastUTMCampaign) ?? param("utm_campaign"),
		utmContent: textOf(row.lastUTMContent) ?? param("utm_content"),
		utmTerm: textOf(row.lastUTMTerm) ?? param("utm_term"),
	};
	return Object.fromEntries(
		Object.entries(click).filter(([, value]) => value !== undefined),
	) as AdClick;
}

/** Показ в сетях (РСЯ): пользователь ничего не искал, запроса нет. */
export function isNetworkClick(click: AdClick): boolean {
	const platform = (click.platformType ?? "").toLowerCase();
	return (
		click.positionType === "none" ||
		click.position === "0" ||
		platform.includes("context") ||
		platform.includes("сет")
	);
}

function labeled(name: string | undefined, id: string | undefined) {
	if (name && id) return `${name} (${id})`;
	return name ?? id;
}

/** Значения рекламных полей сделки; город — где был человек при визите. */
export function adDealFields(
	click: AdClick,
	city: string | undefined,
): Partial<Record<AdDealFieldKey, string>> {
	const values: Partial<Record<AdDealFieldKey, string | undefined>> = {
		campaign: click.campaignName ?? click.campaignId,
		adGroup: click.groupName ?? click.groupId,
		ad: labeled(click.adName, click.adId),
		region: city || click.regionName,
		clickPosition: formatClickPosition({
			adPosition: click.position ?? null,
			adPositionType: click.positionType ?? null,
		}),
		landingPage: click.landingPage,
	};
	return Object.fromEntries(
		Object.entries(values).filter(([, value]) => Boolean(value)),
	);
}

/**
 * UTM-поля сделки по клику из Директа — для сделок, где бот не знал кампанию
 * (UTM_CAMPAIGN пустой: ссылка на бота пришла без метки). Источник всегда
 * yandex/cpc — как у меток SITE_CODES, по ним дашборд сопоставляет расход;
 * метка кампании — из ссылки, иначе ID кампании.
 */
export function adUtmFields(click: AdClick): Record<string, string> {
	const fields: Record<string, string | undefined> = {
		UTM_SOURCE: "yandex",
		UTM_MEDIUM: "cpc",
		UTM_CAMPAIGN: click.utmCampaign ?? click.campaignId,
		UTM_CONTENT: click.utmContent ?? click.adId,
		UTM_TERM: click.utmTerm ?? click.condition,
	};
	return Object.fromEntries(
		Object.entries(fields).filter((entry): entry is [string, string] =>
			Boolean(entry[1]),
		),
	);
}

/** «РК «…» · группа «…» · объявление «…» · условие «…»» для таймлайна. */
export function describeAdClick(click: AdClick): string {
	const parts: string[] = [];
	const campaign = click.campaignName ?? click.campaignId;
	if (campaign) parts.push(`РК «${campaign}»`);
	const group = click.groupName ?? click.groupId;
	if (group) parts.push(`группа «${group}»`);
	const ad = labeled(click.adName, click.adId);
	if (ad) parts.push(`объявление «${ad}»`);
	if (click.condition) parts.push(`условие «${click.condition}»`);
	const position = formatClickPosition({
		adPosition: click.position ?? null,
		adPositionType: click.positionType ?? null,
	});
	if (position) parts.push(`позиция ${position}`);
	return parts.join(" · ") || "Яндекс.Директ";
}
