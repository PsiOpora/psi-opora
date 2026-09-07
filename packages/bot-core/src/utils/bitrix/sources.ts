import type { RedisClient } from "../../storage/redis";
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
 * Сначала надёжно ставит запись согласия в Redis-outbox. Отдельная фоновая
 * задача вызывает crm.deal.update и удаляет запись только после успеха.
 */
export async function setDealConsentTimestamp(
	redis: RedisClient,
	messenger: string,
	dealId: number,
	field: string,
	at: string,
): Promise<void> {
	if (!dealId) throw new Error("Не задана сделка для записи согласия");
	await redis.zadd(DEAL_CONSENT_OUTBOX_KEY, {
		score: Date.now(),
		member: { messenger, dealId, field, at } satisfies DealConsentOutboxEntry,
	});
}

const DEAL_CONSENT_OUTBOX_KEY = "stage-consent:deal-update-outbox";

export interface DealConsentOutboxEntry {
	messenger: string;
	dealId: number;
	field: string;
	at: string;
}

export interface ProcessDealConsentOutboxResult {
	processed: number;
	failed: number;
}

async function deliverDealConsent(
	entry: DealConsentOutboxEntry,
): Promise<void> {
	await bitrixPost(
		"crm.deal.update",
		{ id: entry.dealId, fields: { [entry.field]: entry.at } },
		entry.messenger,
	);
}

/** Повторяет недоставленные crm.deal.update; ошибочные записи остаются в outbox. */
export async function processDealConsentOutbox(
	redis: RedisClient,
	limit = 100,
	deliver: (
		entry: DealConsentOutboxEntry,
	) => Promise<void> = deliverDealConsent,
): Promise<ProcessDealConsentOutboxResult> {
	const entries = (
		await redis.zrange<DealConsentOutboxEntry[]>(
			DEAL_CONSENT_OUTBOX_KEY,
			0,
			Date.now(),
			{ byScore: true },
		)
	).slice(0, limit);
	let processed = 0;
	let failed = 0;

	for (const entry of entries) {
		try {
			await deliver(entry);
			await redis.zrem(DEAL_CONSENT_OUTBOX_KEY, entry);
			processed++;
		} catch (err: unknown) {
			failed++;
			const message = err instanceof Error ? err.message : String(err);
			console.error(
				`[bitrix] не удалось записать согласие (${entry.field}) в сделку ${entry.dealId}: ${message}`,
			);
		}
	}

	return { processed, failed };
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
