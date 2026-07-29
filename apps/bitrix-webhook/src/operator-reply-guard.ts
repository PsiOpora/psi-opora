import type { OperatorReplyMessage } from "@psi-opora/bitrix-webhook-api";
import type { RedisClient } from "@psi-opora/bot-core";

const MIRRORED_OPERATOR_MESSAGE_PREFIX = "operator-";
const OPERATOR_REPLY_DEDUP_TTL_SECONDS = 24 * 60 * 60;

/** Сообщения из единого инбокса сначала уходят клиенту напрямую, а затем
 * отражаются в Открытой линии с нашим служебным ID. Событие, которое Bitrix
 * присылает на это отражение, нельзя повторно отправлять в мессенджер. */
export function isMirroredOperatorReply(reply: OperatorReplyMessage): boolean {
	return String(reply.externalMessageId ?? "").startsWith(
		MIRRORED_OPERATOR_MESSAGE_PREFIX,
	);
}

/** У одного ответа может быть внешний ID коннектора и внутренний ID Bitrix.
 * Внутренний приоритетнее: он однозначно идентифицирует событие на портале. */
export function operatorReplyDedupKey(
	reply: OperatorReplyMessage,
): string | null {
	const messageId = reply.bitrixMessageId ?? reply.externalMessageId;
	if (messageId === undefined) return null;

	const scope = [
		reply.connector ?? "unknown",
		reply.lineId ?? "unknown",
		reply.chatId,
		messageId,
	]
		.map((part) => encodeURIComponent(String(part)))
		.join(":");
	return `bitrix:operator-reply:${scope}`;
}

/** Атомарно захватывает событие перед внешней отправкой. Redis недоступен —
 * работаем fail-open: доставку операторского ответа блокировать нельзя,
 * а собственное эхо всё равно отсекается по префиксу message.id. */
export async function claimOperatorReply(
	redis: RedisClient | null,
	reply: OperatorReplyMessage,
): Promise<boolean> {
	const key = operatorReplyDedupKey(reply);
	if (!redis || !key) return true;

	try {
		return (
			(await redis.set(key, true, {
				nx: true,
				ex: OPERATOR_REPLY_DEDUP_TTL_SECONDS,
			})) === "OK"
		);
	} catch (error) {
		console.error(
			`[bitrix-webhook] не удалось проверить идемпотентность ответа: ${(error as Error).message}`,
		);
		return true;
	}
}
