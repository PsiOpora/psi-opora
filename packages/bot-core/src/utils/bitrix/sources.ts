import { bitrixPost, getEnv, getSourceId, getSourceName } from "./client";

/**
 * Добавляет комментарий в таймлайн сделки (например, ответ на вопрос
 * о рассылке). Ошибки не пробрасываются — комментарий не критичен.
 */
export async function appendDealComment(
	messenger: string,
	dealId: number,
	comment: string,
): Promise<void> {
	const webhookUrl = getEnv(messenger, "BITRIX_WEBHOOK_URL");
	if (!webhookUrl || !dealId) return;

	try {
		await bitrixPost(
			"crm.timeline.comment.add",
			{
				fields: {
					ENTITY_ID: dealId,
					ENTITY_TYPE: "deal",
					COMMENT: comment,
				},
			},
			messenger,
		);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(
			`[bitrix] не удалось добавить комментарий к сделке ${dealId}: ${message}`,
		);
	}
}

/**
 * Пишет дату/время в UF_CRM-поле сделки — используется для меток согласий
 * (оферта/реклама на стадии «Б/п консультация»), которые клиент подтверждает
 * кнопкой в боте. Значение проставляется автоматически, без ручного
 * редактирования оператором. Ошибки не пробрасываются — метка не критична
 * для доставки самого сообщения.
 */
export async function setDealConsentTimestamp(
	messenger: string,
	dealId: number,
	field: string,
	at: string,
): Promise<void> {
	const webhookUrl = getEnv(messenger, "BITRIX_WEBHOOK_URL");
	if (!webhookUrl || !dealId) return;

	try {
		await bitrixPost(
			"crm.deal.update",
			{ id: dealId, fields: { [field]: at } },
			messenger,
		);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(
			`[bitrix] не удалось записать согласие (${field}) в сделку ${dealId}: ${message}`,
		);
	}
}

export interface BitrixSource {
	STATUS_ID: string;
	NAME: string;
}

export async function listBitrixSources(
	messenger: string,
): Promise<BitrixSource[]> {
	const webhookUrl = getEnv(messenger, "BITRIX_WEBHOOK_URL");
	if (!webhookUrl)
		throw new Error(`BITRIX_WEBHOOK_URL не задан для ${messenger}`);

	return bitrixPost<BitrixSource[]>(
		"crm.status.list",
		{
			filter: { ENTITY_ID: "SOURCE" },
			select: ["STATUS_ID", "NAME"],
		},
		messenger,
	);
}

export async function registerBitrixSource(messenger: string): Promise<void> {
	const webhookUrl = getEnv(messenger, "BITRIX_WEBHOOK_URL");
	if (!webhookUrl)
		throw new Error(`BITRIX_WEBHOOK_URL не задан для ${messenger}`);

	const sourceId = getSourceId(messenger);
	const sourceName = getSourceName(messenger);

	try {
		await bitrixPost(
			"crm.status.add",
			{
				fields: { ENTITY_ID: "SOURCE", STATUS_ID: sourceId, NAME: sourceName },
			},
			messenger,
		);
		console.log(`[bitrix] источник создан: ${sourceId} (${sourceName})`);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		if (String(message).includes("Duplicate")) {
			console.log(`[bitrix] источник уже существует: ${sourceId}`);
			return;
		}
		throw err;
	}
}

// Регистрация коннектора (imconnector.register) и активация линии теперь
// происходят нативно — кнопка в дашборде (apps/dashboard/.../bot-connector-card.tsx,
// b24.callMethod, гарантированный app context) и виджет настроек канала
// (packages/api/src/routers/bot-connector), а не серверный вызов отсюда.
