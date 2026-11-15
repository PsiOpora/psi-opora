import type { RedisClient } from "../storage/redis";

/**
 * Как долго помним, что на сообщение с кнопками уже нажимали. Кнопки в
 * сообщениях (напоминания, вопросы сценария) живут долго, поэтому берём с
 * запасом: повторный клик по тому же сообщению через месяц — уже не «случайный
 * двойной тап», но и повторно выполнять действие нет смысла.
 */
const CLICK_TTL_SEC = 30 * 24 * 60 * 60;

const MEMORY_MAX_ENTRIES = 10_000;
// Без Redis (локальная разработка/тесты) — тот же контракт в памяти процесса.
const memory = new Map<string, number>();

function clickKey(
	messenger: string,
	chatId: string | number,
	messageId: string | number,
) {
	return `cbclick:${messenger}:${chatId}:${messageId}`;
}

/**
 * Засчитывает первое нажатие на кнопку конкретного сообщения. Любые следующие
 * нажатия на кнопки того же сообщения (случайный двойной тап, нажатие другой
 * кнопки до того, как первая обработалась, ретрай вебхука) получают `false` и
 * должны быть проигнорированы.
 *
 * Вызывать под пользовательским локом (withUserLock): сам по себе SET NX
 * атомарен, но лок гарантирует, что победитель успеет полностью обработать
 * апдейт и записать сессию до того, как проигравший вообще начнёт работу.
 */
export async function claimCallbackClick(
	redis: RedisClient | undefined,
	messenger: string,
	chatId: string | number,
	messageId: string | number,
): Promise<boolean> {
	const key = clickKey(messenger, chatId, messageId);
	if (redis) {
		return Boolean(await redis.set(key, 1, { nx: true, ex: CLICK_TTL_SEC }));
	}
	const now = Date.now();
	const expiresAt = memory.get(key);
	if (expiresAt !== undefined && expiresAt > now) return false;
	if (memory.size >= MEMORY_MAX_ENTRIES) {
		for (const [k, v] of memory) if (v <= now) memory.delete(k);
		if (memory.size >= MEMORY_MAX_ENTRIES) {
			const oldest = memory.keys().next().value;
			if (oldest !== undefined) memory.delete(oldest);
		}
	}
	memory.set(key, now + CLICK_TTL_SEC * 1000);
	return true;
}

/**
 * Возвращает нажатие, если обработка упала: иначе клиент не смог бы повторить
 * нажатие, а действие так и не было выполнено.
 */
export async function releaseCallbackClick(
	redis: RedisClient | undefined,
	messenger: string,
	chatId: string | number,
	messageId: string | number,
): Promise<void> {
	const key = clickKey(messenger, chatId, messageId);
	if (redis) {
		await redis.del(key).catch(() => {});
		return;
	}
	memory.delete(key);
}
