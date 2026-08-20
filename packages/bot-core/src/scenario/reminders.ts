import type { RedisClient, StorageAdapter } from "../storage/redis";
import type { ConsultationSession } from "../types/context";
import { logBotMessage } from "../utils/message-log";
import { buildReminder, type ScenarioMessage } from "./engine";
import { getScenarioTexts } from "./texts";

/**
 * Напоминания «вы не закончили диалог»: если пользователь молчит дольше
 * REMINDER_DELAY_MS — шлём напоминание один раз; если молчит и после него —
 * тихо завершаем сценарий.
 *
 * Ожидающие ответа сессии хранятся в Redis sorted set
 * (score = момент последнего вопроса), обходятся cron-эндпоинтом бота.
 */

export const REMINDER_DELAY_MS = 30 * 60 * 1000;

function pendingKey(messenger: string): string {
	return `scenario:pending:${messenger}`;
}

/** Сценарий ждёт ответа — регистрируем/обновляем для напоминаний. */
export async function markScenarioAwaiting(
	redis: RedisClient,
	messenger: string,
	sessionKey: string,
): Promise<void> {
	await redis.zadd(pendingKey(messenger), {
		score: Date.now(),
		member: sessionKey,
	});
}

/** Сценарий завершён — напоминание не нужно. */
export async function clearScenarioAwaiting(
	redis: RedisClient,
	messenger: string,
	sessionKey: string,
): Promise<void> {
	await redis.zrem(pendingKey(messenger), sessionKey);
}

export interface ReminderRunOptions {
	redis: RedisClient;
	messenger: string;
	storage: StorageAdapter<ConsultationSession>;
	/** Отправка сообщения пользователю; sessionKey — chat id (TG) / user id (MAX). */
	send: (sessionKey: string, message: ScenarioMessage) => Promise<void>;
}

export interface ReminderRunResult {
	reminded: number;
	expired: number;
}

/** Один проход по «зависшим» сессиям. Вызывается cron-эндпоинтом бота. */
export async function runScenarioReminders({
	redis,
	messenger,
	storage,
	send,
}: ReminderRunOptions): Promise<ReminderRunResult> {
	const texts = await getScenarioTexts();
	const key = pendingKey(messenger);
	const dueBefore = Date.now() - REMINDER_DELAY_MS;

	const due = await redis.zrange<string[]>(key, 0, dueBefore, {
		byScore: true,
	});

	const result: ReminderRunResult = { reminded: 0, expired: 0 };

	for (const sessionKey of due) {
		// Текст напоминания нужен и в catch — чтобы записать в историю
		// неудачную попытку отправки (см. ниже).
		let attemptedText: string | undefined;
		try {
			const session = await storage.read(sessionKey);
			const state = session?.scenario;

			if (!session || !state || state.step === "done") {
				await redis.zrem(key, sessionKey);
				continue;
			}

			if (state.reminded) {
				// Напоминание не помогло — тихо завершаем сценарий
				state.step = "done";
				await storage.write(sessionKey, session);
				await redis.zrem(key, sessionKey);
				result.expired++;
				continue;
			}

			const message = buildReminder(state, texts);
			if (!message) {
				await redis.zrem(key, sessionKey);
				continue;
			}

			attemptedText = message.text;
			await send(sessionKey, message);
			await logBotMessage({
				messenger,
				userId: sessionKey,
				direction: "out",
				source: "reminder",
				text: message.text,
			});
			state.reminded = true;
			await storage.write(sessionKey, session);
			await redis.zadd(key, { score: Date.now(), member: sessionKey });
			result.reminded++;
		} catch (err) {
			// Не удалось отправить (бот заблокирован и т.п.) — убираем из очереди,
			// чтобы не зациклиться на одном пользователе. Сам факт неудачной
			// попытки пишем в историю со статусом "failed": в инбоксе это видно
			// как «не доставлено», иначе напоминание пропадало бы бесследно.
			console.error(
				`[reminder] ${messenger} sessionKey=${sessionKey}: ${(err as Error).message}`,
			);
			if (attemptedText) {
				await logBotMessage({
					messenger,
					userId: sessionKey,
					direction: "out",
					source: "reminder",
					text: attemptedText,
					status: "failed",
				});
			}
			await redis.zrem(key, sessionKey).catch(() => {});
		}
	}

	return result;
}
