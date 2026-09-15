import { insertBotMessage } from "@psi-opora/db/queries";

export type BotMessageDirection = "in" | "out";
export type BotMessageSource = "scenario" | "reminder" | "widget" | "broadcast";

export interface BotMessageLogEntry {
	messenger: string;
	/** ID клиента в мессенджере (chat id TG / user id MAX). */
	userId: string | number | undefined;
	direction: BotMessageDirection;
	source: BotMessageSource;
	text: string;
	/** По умолчанию "text". voice/image/file — заливаем mediaS3Key вложения. */
	kind?: "text" | "voice" | "image" | "file";
	mediaS3Key?: string;
	mediaMimeType?: string;
	mediaDurationSec?: number;
	mediaFileName?: string;
	/** По умолчанию "sent". "failed" — отправка в мессенджер не удалась;
	 * запись всё равно нужна, чтобы в истории было видно «не доставлено». */
	status?: "sent" | "delivered" | "read" | "failed";
	/** ID сообщения во внешней системе — по нему прилетают ack-статусы. */
	externalId?: string;
}

/**
 * Пишет сообщение в журнал bot_messages. Ошибки записи не должны
 * ломать диалог с клиентом — логируются и глотаются.
 * Возвращает id записи (undefined при ошибке) — нужен, например, чтобы потом
 * отметить на этом же сообщении отправку гайда на email.
 */
export async function logBotMessage(
	entry: BotMessageLogEntry,
): Promise<string | undefined> {
	if (entry.userId === undefined || entry.userId === null) return undefined;
	const text = entry.text.trim();
	if (!text) return undefined;

	try {
		return await insertBotMessage({
			messenger: entry.messenger,
			userId: String(entry.userId),
			direction: entry.direction,
			source: entry.source,
			text,
			kind: entry.kind,
			mediaS3Key: entry.mediaS3Key,
			mediaMimeType: entry.mediaMimeType,
			mediaDurationSec: entry.mediaDurationSec,
			mediaFileName: entry.mediaFileName,
			status: entry.status,
			externalId: entry.externalId,
		});
	} catch (err) {
		const error = err as Error;
		console.error(
			`[messages] не удалось записать сообщение в журнал: ${error.message}`,
			error.cause ?? "",
			error.stack ?? "",
		);
		return undefined;
	}
}
