import { getYandexMetrikaSettings } from "@psi-opora/db/queries";
import { bitrixPost, getBotId, getSourceId } from "./client";
import { DEFAULT_ASSIGNED_BY_ID } from "./contact";
import type { DealData } from "./types";

// ID значений поля "Мессенджер" (UF_CRM_1779643796551) в Bitrix24.
const MESSENGER_FIELD_VALUES: Record<string, string> = {
	max: "326", // МАКС
	telegram: "328", // Telegram
};
const MESSENGER_FIELD_OTHER = "376"; // Другой

// ID значения "Консультация" поля "Продукт" (UF_CRM_1779045469683).
// Для флоу гайда «продукт» не подставляем — это лид-магнит, а не заявка
// на конкретную услугу.
const PRODUCT_CONSULT_ID = "258";

const AUDIENCE_LABELS: Record<NonNullable<DealData["audience"]>, string> = {
	child: "Ребёнок",
	self: "Для себя",
};
const ISSUE_LABELS: Record<NonNullable<DealData["issue"]>, string> = {
	eating: "Питание",
	ocd: "ОКР",
	other: "Другое",
};

// Поле "Расстройство" (UF_CRM_1779041362411, множественный список) в Bitrix24 —
// сейчас заполняется операторами вручную и непоследовательно, хотя тема почти
// всегда уже видна из названия рекламной кампании (см. site-codes.ts и
// значения UTM_CAMPAIGN вида search_anorexia_..., direct_okr, РК- ОКР...).
// Проставляем автоматически по ключевым словам; если ни одно не совпало,
// поле не трогаем — ошибочная категория хуже отсутствующей.
const DISORDER_FIELD = "UF_CRM_1779041362411";
const DISORDER_SUBSTRING_KEYWORDS: Array<[RegExp, string]> = [
	[/анорекси|anorexia/, "46"], // Анорексия
	[/булими|bulimia/, "48"], // Булимия
	[/депресси|depression/, "50"], // Депрессия
	[/онколог|oncology/, "54"], // Онкология
	[/паническ|panic/, "58"], // Панические атаки
	[/переедан/, "60"], // Переедание
	[/психосоматик|psychosomatic/, "62"], // Психосоматика
	[/тревог|anxiety/, "66"], // Тревога
	[/созависим|codependen/, "72"], // Созависимость
	[/алко|нарко|\balko\b|\bnarco\b/, "44"], // Алко-Нарко
];
// Короткие/неоднозначные метки сверяем только по целому токену кампании
// (после разбиения по не-буквенным символам), чтобы "окр" не сработал как
// часть случайной подстроки.
const DISORDER_TOKEN_KEYWORDS: Record<string, string> = {
	окр: "56", // Окр
	okr: "56",
	ocd: "56",
};

export function resolveDisorderIds(campaign: string | undefined): string[] {
	if (!campaign) return [];
	const lower = campaign.toLowerCase();
	const ids = new Set<string>();
	for (const [pattern, id] of DISORDER_SUBSTRING_KEYWORDS) {
		if (pattern.test(lower)) ids.add(id);
	}
	for (const token of lower.split(/[^a-zа-яё0-9]+/)) {
		const id = DISORDER_TOKEN_KEYWORDS[token];
		if (id) ids.add(id);
	}
	return [...ids];
}

/** Короткая метка ветки сценария для заголовка сделки — видна в канбане без открытия карточки. */
function buildFlowLabel(data: DealData): string | undefined {
	if (data.flow === "consult") return "Консультация";
	if (data.flow === "book_preorder") return "Предзаказ книги";
	if (data.flow === "guide") {
		const details = [
			data.audience && AUDIENCE_LABELS[data.audience],
			data.issue && ISSUE_LABELS[data.issue],
		]
			.filter(Boolean)
			.join("/");
		return details ? `Гайд: ${details}` : "Гайд";
	}
	return undefined;
}

export async function buildDealFields(data: DealData, contactId: number) {
	const messenger = data.messenger ?? "telegram";
	const botId = getBotId(messenger);
	const description = [data.source, data.campaign].filter(Boolean).join(" / ");
	const flowLabel = buildFlowLabel(data);

	// Код поля для ClientID Метрики настраивается администратором в дашборде
	// (/settings/metrika), а не в .env — без него просто не пишем это поле.
	const metrikaSettings = data.ymClientId
		? await getYandexMetrikaSettings()
		: null;
	const clientIdField = metrikaSettings?.bitrixClientIdField;
	const disorderIds = resolveDisorderIds(data.campaign);

	return {
		TITLE: `Заявка (${[flowLabel, botId].filter(Boolean).join(", ")}): ${data.name}`,
		CONTACT_IDS: [contactId],
		ASSIGNED_BY_ID: DEFAULT_ASSIGNED_BY_ID,
		SOURCE_ID: getSourceId(messenger),
		SOURCE_DESCRIPTION: description || `${messenger} бот`,
		UTM_SOURCE: data.source ?? messenger,
		UTM_MEDIUM: `${messenger}_bot`,
		UTM_CAMPAIGN: data.campaign ?? "",
		UTM_CONTENT: botId,
		UF_CRM_1779643796551:
			MESSENGER_FIELD_VALUES[messenger] ?? MESSENGER_FIELD_OTHER,
		...(data.ymClientId && clientIdField
			? { [clientIdField]: data.ymClientId }
			: {}),
		...(data.flow === "consult"
			? { UF_CRM_1779045469683: PRODUCT_CONSULT_ID }
			: {}),
		...(disorderIds.length ? { [DISORDER_FIELD]: disorderIds } : {}),
		COMMENTS: [
			`Бот: ${botId}`,
			data.telegramUserId ? `${messenger} user_id: ${data.telegramUserId}` : "",
			data.comment ?? "",
		]
			.filter(Boolean)
			.join("\n"),
	};
}

export async function linkBitrixTrace(
	messenger: string,
	contactId: number,
	dealId: number,
	data: DealData,
): Promise<void> {
	const trace = {
		SOURCE_ID: getSourceId(messenger),
		SOURCE_DESC:
			[data.source, data.campaign].filter(Boolean).join(" / ") ||
			`${messenger} бот`,
	};

	try {
		await bitrixPost(
			"crm.tracking.trace.add",
			{
				TRACE: JSON.stringify(trace),
				ENTITIES: [
					{ TYPE: "CONTACT", ID: contactId },
					{ TYPE: "DEAL", ID: dealId },
				],
			},
			messenger,
		);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(
			`[bitrix] не удалось привязать трейс сквозной аналитики: ${message}`,
		);
	}
}
