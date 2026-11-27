import { createRedisClient } from "@psi-opora/bot-core";

const KEY = "tg-userbot:deferred-journal";
const RETRY_MS = 30_000;

export interface TelegramJournalEntry {
	externalChatId: string;
	connectorId: string;
	externalId?: string;
	bitrixMessageId?: number;
	direction: "in" | "out";
	source: "scenario" | "widget" | "operator";
	text: string;
	status?: "sent" | "failed";
	operatorId?: string;
	operatorName?: string;
	createdAt: number;
	kind?: "image" | "file";
	mediaS3Key?: string;
	mediaMimeType?: string;
	mediaFileName?: string;
	profile?: {
		firstName?: string;
		lastName?: string;
		username?: string | null;
		isPremium?: boolean;
	};
}

export async function deferTelegramJournal(
	entry: TelegramJournalEntry,
	error?: unknown,
): Promise<void> {
	if (error !== undefined)
		console.error("[tg-userbot] запись в журнал отложена:", error);
	await createRedisClient().zadd(KEY, {
		score: Date.now(),
		member: { ...entry, id: crypto.randomUUID() },
	});
}

/** Подтверждаем только после записи. При сбое запись остаётся в Redis. */
export async function processDeferredTelegramJournal(
	write: (entry: TelegramJournalEntry & { id: string }) => Promise<void>,
): Promise<void> {
	const redis = createRedisClient();
	const entries = await redis.zrange<(TelegramJournalEntry & { id: string })[]>(
		KEY,
		0,
		24,
	);
	for (const entry of entries) {
		const score = await redis.zscore(KEY, entry);
		if (score === null) continue;
		if (score > Date.now()) break;
		try {
			await write(entry);
		} catch (error) {
			console.error(
				`[tg-userbot] повтор записи в журнал отложен: id=${entry.id} (${error instanceof Error ? error.name : "unknown"})`,
			);
			await redis.eval(
				"return redis.call('ZADD', KEYS[1], 'XX', ARGV[1], ARGV[2])",
				[KEY],
				[Date.now() + RETRY_MS, entry],
			);
			continue;
		}
		await redis.zrem(KEY, entry);
	}
}
