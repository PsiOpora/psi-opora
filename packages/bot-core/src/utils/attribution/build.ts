import type {
	AdDealFieldKey,
	AdTouch,
	DealTouchRole,
} from "@psi-opora/db/queries";
import type { AdEntityNames, AdEntityRefs } from "./ad-directory";
import { entityKey } from "./ad-directory";

/**
 * Атрибуция сделки по цепочке касаний с рекламой: что писать в стандартные
 * UTM-поля Bitrix, читаемое описание источника для карточки и комментарий
 * с полной цепочкой для таймлайна.
 */
export interface DealAttribution {
	utmSource?: string;
	utmMedium?: string;
	utmCampaign?: string;
	utmContent?: string;
	utmTerm?: string;
	/** Одна строка для SOURCE_DESCRIPTION: «Яндекс.Директ · РК «…» · объявление «…»». */
	sourceDescription: string;
	/** Строки для поля «Комментарий» сделки. */
	commentLines: string[];
	/** Текст комментария в таймлайн сделки: вся цепочка касаний. */
	timelineComment: string;
	touches: Array<{ id: string; role: DealTouchRole }>;
	/**
	 * Значения для отдельных полей сделки (коды полей — в настройках
	 * /settings/metrika). Поисковый запрос сюда не входит: его дописывает крон
	 * по отчёту Директа (см. search-queries.ts).
	 */
	dealFields: Partial<Record<AdDealFieldKey, string>>;
	/** Касание, запрос которого стоит искать в отчёте Директа; нет — не ищем. */
	searchQueryTouchId?: string;
}

export interface BuildAttributionInput {
	/** Источник/кампания из самой ссылки на бота (SITE_CODES) — запасной вариант без касаний. */
	linkSource?: string;
	linkCampaign?: string;
	/** От старых к новым. */
	touches: AdTouch[];
	names: AdEntityNames;
}

export function collectEntityRefs(touches: AdTouch[]): AdEntityRefs {
	const unique = (values: Array<string | null>) => [
		...new Set(values.filter((v): v is string => Boolean(v))),
	];
	return {
		campaignIds: unique(touches.map((t) => t.adCampaignId)),
		groupIds: unique(touches.map((t) => t.adGroupId)),
		adIds: unique(touches.map((t) => t.adId)),
		keywordIds: unique(touches.map((t) => t.keywordId)),
	};
}

const MSK_FORMAT = new Intl.DateTimeFormat("ru-RU", {
	timeZone: "Europe/Moscow",
	day: "2-digit",
	month: "2-digit",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
});

function sourceLabel(
	source: string | null,
	medium: string | null,
): string | undefined {
	if (!source) return undefined;
	if (source === "yandex") return medium === "cpc" ? "Яндекс.Директ" : "Яндекс";
	return source;
}

/** Метка кампании без читаемого названия бывает просто числом — тогда это ID кабинета. */
function isNumeric(value: string): boolean {
	return /^\d+$/.test(value);
}

function describeTouch(touch: AdTouch, names: AdEntityNames): string {
	const parts: string[] = [];
	const source = sourceLabel(touch.utmSource, touch.utmMedium);
	if (source) parts.push(source);

	const campaignName = touch.adCampaignId
		? names.get(entityKey("campaign", touch.adCampaignId))
		: undefined;
	if (campaignName) {
		parts.push(`РК «${campaignName}»`);
	} else if (touch.utmCampaign && !isNumeric(touch.utmCampaign)) {
		parts.push(`РК «${touch.utmCampaign}»`);
	} else if (touch.adCampaignId) {
		parts.push(`РК ${touch.adCampaignId}`);
	}

	if (touch.adGroupId) {
		const group = names.get(entityKey("group", touch.adGroupId));
		parts.push(group ? `группа «${group}»` : `группа ${touch.adGroupId}`);
	}
	if (touch.adId) {
		const ad = names.get(entityKey("ad", touch.adId));
		parts.push(
			ad ? `объявление «${ad}» (${touch.adId})` : `объявление ${touch.adId}`,
		);
	}
	const keyword =
		(touch.keywordId && names.get(entityKey("keyword", touch.keywordId))) ||
		touch.utmTerm;
	if (keyword) parts.push(`ключ «${keyword}»`);
	else if (touch.keywordId) parts.push(`ключ ${touch.keywordId}`);

	return parts.join(" · ");
}

const POSITION_TYPE_LABELS: Record<string, string> = {
	premium: "премиум-показы",
	dynamic_places: "динамические места",
	other: "блок справа или внизу",
};

/** «1 · премиум-показы»; позиция 0 или тип none — показ в сетях, не на поиске. */
export function formatClickPosition(touch: AdTouch): string | undefined {
	if (touch.adPositionType === "none" || touch.adPosition === "0") {
		return "сети (РСЯ)";
	}
	const type = touch.adPositionType
		? POSITION_TYPE_LABELS[touch.adPositionType]
		: undefined;
	if (touch.adPosition && type) return `${touch.adPosition} · ${type}`;
	return touch.adPosition ?? type;
}

const DEVICE_LABELS: Record<string, string> = {
	desktop: "компьютер",
	mobile: "смартфон",
	tablet: "планшет",
};

/** Регион, позиция и устройство одной строкой для таймлайна. */
function describeContext(touch: AdTouch): string | undefined {
	const parts: string[] = [];
	const region = touch.regionName ?? touch.regionId;
	if (region) parts.push(`регион ${region}`);
	const position = formatClickPosition(touch);
	if (position) parts.push(`позиция ${position}`);
	if (touch.deviceType) {
		parts.push(DEVICE_LABELS[touch.deviceType] ?? touch.deviceType);
	}
	return parts.length ? parts.join(" · ") : undefined;
}

function campaignLabel(
	touch: AdTouch,
	names: AdEntityNames,
): string | undefined {
	const name = touch.adCampaignId
		? names.get(entityKey("campaign", touch.adCampaignId))
		: undefined;
	if (name) return name;
	if (touch.utmCampaign && !isNumeric(touch.utmCampaign)) {
		return touch.utmCampaign;
	}
	return touch.adCampaignId ?? touch.utmCampaign ?? undefined;
}

function dealFieldsOf(
	touch: AdTouch,
	names: AdEntityNames,
): Partial<Record<AdDealFieldKey, string>> {
	const group = touch.adGroupId
		? (names.get(entityKey("group", touch.adGroupId)) ?? touch.adGroupId)
		: undefined;
	const adName = touch.adId
		? names.get(entityKey("ad", touch.adId))
		: undefined;
	const ad = adName ? `${adName} (${touch.adId})` : (touch.adId ?? undefined);
	const values: Partial<Record<AdDealFieldKey, string | undefined>> = {
		campaign: campaignLabel(touch, names),
		adGroup: group,
		ad,
		region: touch.regionName ?? touch.regionId ?? undefined,
		clickPosition: formatClickPosition(touch),
		landingPage: touch.landingUrl ?? undefined,
	};
	return Object.fromEntries(
		Object.entries(values).filter(([, value]) => Boolean(value)),
	);
}

/**
 * Запрос есть только у клика на поиске: в сетях (РСЯ) пользователь ничего не
 * искал. Без группы объявлений строку отчёта не сопоставить.
 */
function needsSearchQuery(touch: AdTouch): boolean {
	return (
		Boolean(touch.adGroupId) &&
		touch.utmSource === "yandex" &&
		touch.sourceType !== "context" &&
		touch.adPositionType !== "none" &&
		touch.adPosition !== "0"
	);
}

function roleAt(index: number, total: number): DealTouchRole {
	if (total === 1) return "first_last";
	if (index === 0) return "first";
	return index === total - 1 ? "last" : "middle";
}

/**
 * null — касаний нет, сделка создаётся по старой схеме (метка из ссылки).
 * Значения UTM берутся с последнего касания (ближайшего к заявке): оно
 * привело клиента в бота. UTM_CAMPAIGN оставляем исходной меткой — по числовому
 * ID в её конце дашборд сопоставляет расход Директа (ad-spend-match.ts);
 * читаемые названия уходят в описание источника и комментарии.
 */
export function buildAttribution(
	input: BuildAttributionInput,
): DealAttribution | null {
	const { touches, names } = input;
	const last = touches.at(-1);
	if (!last) return null;
	const first = touches[0] ?? last;

	const adTitle = last.adId ? names.get(entityKey("ad", last.adId)) : undefined;
	const keywordName = last.keywordId
		? names.get(entityKey("keyword", last.keywordId))
		: undefined;

	const lastDescription = describeTouch(last, names);
	const commentLines = [`Реклама (последнее касание): ${lastDescription}`];
	if (touches.length > 1) {
		commentLines.push(
			`Реклама (первое касание): ${describeTouch(first, names)}`,
			`Касаний с рекламой: ${touches.length}`,
		);
	}

	const timelineLines = [
		`Касания с рекламой до заявки (${touches.length}):`,
		...touches.flatMap((touch, index) => {
			const context = describeContext(touch);
			return [
				`${index + 1}. ${MSK_FORMAT.format(touch.occurredAt)} МСК — ${describeTouch(touch, names)}`,
				...(context ? [`   ${context}`] : []),
				...(touch.landingUrl ? [`   Страница: ${touch.landingUrl}`] : []),
			];
		}),
		`Первое касание: ${describeTouch(first, names)}`,
		`Последнее касание: ${lastDescription}`,
	];

	return {
		utmSource: last.utmSource ?? input.linkSource ?? undefined,
		utmMedium: last.utmMedium ?? undefined,
		utmCampaign:
			last.utmCampaign ?? input.linkCampaign ?? last.adCampaignId ?? undefined,
		// В карточке видно название объявления; ID в скобках оставляет метку
		// уникальной (заголовки у объявлений бывают одинаковыми).
		utmContent: adTitle
			? `${adTitle} (${last.adId})`
			: (last.utmContent ?? last.adId ?? undefined),
		utmTerm: last.utmTerm ?? keywordName ?? undefined,
		sourceDescription: lastDescription,
		commentLines,
		timelineComment: timelineLines.join("\n"),
		touches: touches.map((touch, index) => ({
			id: touch.id,
			role: roleAt(index, touches.length),
		})),
		dealFields: dealFieldsOf(last, names),
		...(needsSearchQuery(last) ? { searchQueryTouchId: last.id } : {}),
	};
}
