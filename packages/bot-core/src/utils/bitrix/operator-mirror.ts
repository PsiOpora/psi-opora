import { createHash } from "node:crypto";
import type { RedisClient } from "../../storage/redis";

const OPERATOR_MIRROR_ECHO_TTL_SECONDS = 5 * 60;

export interface OperatorMirrorEcho {
	connectorId?: string;
	lineId?: string | number;
	userId: string | number;
	operatorId?: string | number;
	text: string;
}

/** Bitrix не возвращает переданный коннектором message.id в
 * OnImConnectorMessageAdd, поэтому собственное эхо сопоставляем по полям,
 * которые контракт события действительно возвращает. Текст хешируем, чтобы
 * не хранить содержание переписки в Redis-ключах и логах. */
export function operatorMirrorEchoKey(echo: OperatorMirrorEcho): string | null {
	if (
		!echo.connectorId ||
		echo.lineId === undefined ||
		echo.operatorId === undefined
	) {
		return null;
	}

	const textHash = createHash("sha256").update(echo.text.trim()).digest("hex");
	const scope = [
		echo.connectorId,
		echo.lineId,
		echo.userId,
		echo.operatorId,
		textHash,
	]
		.map((part) => encodeURIComponent(String(part)))
		.join(":");
	return `bitrix:operator-mirror:${scope}`;
}

/** Один ключ хранит очередь одноразовых маркеров: если оператор подряд
 * отправил одинаковый текст несколько раз, каждое отражение получит свой
 * маркер и каждое webhook-эхо потребит ровно один. */
export async function enqueueOperatorMirrorEcho(
	redis: RedisClient | null | undefined,
	echo: OperatorMirrorEcho,
): Promise<boolean> {
	const key = operatorMirrorEchoKey(echo);
	if (!redis || !key) return false;

	try {
		await redis.rpush(key, true);
		await redis.expire(key, OPERATOR_MIRROR_ECHO_TTL_SECONDS);
		return true;
	} catch (error) {
		console.error(
			`[bitrix] не удалось зарегистрировать эхо сообщения оператора: ${(error as Error).message}`,
		);
		return false;
	}
}

/** Возвращает true только для заранее зарегистрированного отражения. */
export async function consumeOperatorMirrorEcho(
	redis: RedisClient | null | undefined,
	echo: OperatorMirrorEcho,
): Promise<boolean> {
	const key = operatorMirrorEchoKey(echo);
	if (!redis || !key) return false;

	try {
		return (await redis.lpop<boolean>(key)) === true;
	} catch (error) {
		console.error(
			`[bitrix-webhook] не удалось проверить эхо сообщения оператора: ${(error as Error).message}`,
		);
		return false;
	}
}
