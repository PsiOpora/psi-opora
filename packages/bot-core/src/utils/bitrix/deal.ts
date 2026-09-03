import { env } from "@psi-opora/config";
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

/** Короткая метка ветки сценария для заголовка сделки — видна в канбане без открытия карточки. */
function buildFlowLabel(data: DealData): string | undefined {
	if (data.flow === "consult") return "Консультация";
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

export function buildDealFields(data: DealData, contactId: number) {
	const messenger = data.messenger ?? "telegram";
	const botId = getBotId(messenger);
	const description = [data.source, data.campaign].filter(Boolean).join(" / ");
	const flowLabel = buildFlowLabel(data);
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
		// Поле для ClientID Метрики создаётся вручную на портале (см.
		// BITRIX_YM_CLIENT_ID_FIELD в .env.example) — без него просто не пишем.
		...(data.ymClientId && env.BITRIX_YM_CLIENT_ID_FIELD
			? { [env.BITRIX_YM_CLIENT_ID_FIELD]: data.ymClientId }
			: {}),
		...(data.flow === "consult"
			? { UF_CRM_1779045469683: PRODUCT_CONSULT_ID }
			: {}),
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
