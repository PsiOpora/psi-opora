import { createRedisClient } from "@psi-opora/bot-core";

export interface MaxOutboundMessage {
	memberId: string;
	openLineId: string;
	connectorId: string;
	jobId: string;
	action?: "send" | "delete";
	chatId: string;
	text?: string;
	externalId?: string;
	journalMessageId?: string;
}

export interface MaxSendResult {
	ok: boolean;
	error?: string;
	externalId?: string;
}

function outboxKey(
	message: Pick<MaxOutboundMessage, "memberId" | "openLineId" | "connectorId">,
): string {
	return `max-userbot:outbox:${message.memberId}:${message.openLineId}:${message.connectorId}`;
}

function processingKey(
	message: Pick<MaxOutboundMessage, "memberId" | "openLineId" | "connectorId">,
): string {
	return `${outboxKey(message)}:processing`;
}

export interface ClaimedMaxOutboundMessage {
	message: MaxOutboundMessage;
	/** Точное Redis-значение: используется для атомарного подтверждения. */
	receipt: string;
}

const SEND_RESULT_TTL_SECONDS = 60;

export async function pushMaxOutboundMessage(
	message: MaxOutboundMessage,
): Promise<void> {
	const redis = createRedisClient();
	await redis.rpush(outboxKey(message), message);
}

function parseClaimedMessage(raw: string): MaxOutboundMessage {
	const decoded = JSON.parse(raw) as MaxOutboundMessage | string;
	return typeof decoded === "string"
		? (JSON.parse(decoded) as MaxOutboundMessage)
		: decoded;
}

export async function claimMaxOutboundMessage(
	memberId: string,
	openLineId: string,
	connectorId: string,
): Promise<ClaimedMaxOutboundMessage | null> {
	const redis = createRedisClient();
	const ref = { memberId, openLineId, connectorId };
	const raw = await redis.eval(
		"local item = redis.call('LPOP', KEYS[1]); if item then redis.call('RPUSH', KEYS[2], item) end; return item",
		[outboxKey(ref), processingKey(ref)],
		[],
	);
	if (typeof raw !== "string") return null;
	return { message: parseClaimedMessage(raw), receipt: raw };
}

export async function ackMaxOutboundMessage(
	message: Pick<MaxOutboundMessage, "memberId" | "openLineId" | "connectorId">,
	receipt: string,
): Promise<void> {
	const redis = createRedisClient();
	await redis.eval(
		"local item = cjson.decode(ARGV[1]); return redis.call('LREM', KEYS[1], 1, item)",
		[processingKey(message)],
		[receipt],
	);
}

/** Возвращает незавершённые после падения задания в начало очереди. */
export async function recoverMaxOutboundMessages(
	memberId: string,
	openLineId: string,
	connectorId: string,
): Promise<void> {
	const redis = createRedisClient();
	const ref = { memberId, openLineId, connectorId };
	await redis.eval(
		"local item = redis.call('RPOP', KEYS[1]); while item do redis.call('LPUSH', KEYS[2], item); item = redis.call('RPOP', KEYS[1]); end; return 1",
		[processingKey(ref), outboxKey(ref)],
		[],
	);
}

export async function setMaxSendResult(
	jobId: string,
	result: MaxSendResult,
): Promise<void> {
	const redis = createRedisClient();
	await redis.set(`max-userbot:send-result:${jobId}`, result, {
		ex: SEND_RESULT_TTL_SECONDS,
	});
}

export async function getMaxSendResult(
	jobId: string,
): Promise<MaxSendResult | null> {
	const redis = createRedisClient();
	return (
		(await redis.get<MaxSendResult>(`max-userbot:send-result:${jobId}`)) ?? null
	);
}
