import type { AdTouch, DealTouchRole } from "@psi-opora/db/queries";
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
		...touches.flatMap((touch, index) => [
			`${index + 1}. ${MSK_FORMAT.format(touch.occurredAt)} МСК — ${describeTouch(touch, names)}`,
			...(touch.landingUrl ? [`   Страница: ${touch.landingUrl}`] : []),
		]),
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
	};
}
