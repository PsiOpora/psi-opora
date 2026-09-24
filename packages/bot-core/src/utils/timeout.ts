/**
 * Потолок для запросов к БД на пути ответа клиенту. Мёртвый сокет в пуле
 * (сеть k3s тихо рвёт соединения) иначе держит запрос минутами — до
 * TCP-таймаута ОС, и бот молчит всё это время.
 */
export const DB_TIMEOUT_MS = 5_000;

/**
 * Отклоняет промис, если он не завершился за `ms`. Сам исходный запрос не
 * отменяется (у драйвера БД нет AbortSignal) — просто перестаём его ждать.
 */
export async function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	label: string,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`${label}: нет ответа за ${ms}мс`)),
			ms,
		);
	});
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		clearTimeout(timer);
	}
}

const SLOW_UPDATE_MS = 3_000;

/** Пишет в лог апдейты, обработка которых заняла заметное время. */
export function logSlowUpdate(
	messenger: string,
	details: string,
	startedAt: number,
): void {
	const elapsed = Date.now() - startedAt;
	if (elapsed < SLOW_UPDATE_MS) return;
	console.warn(
		`${new Date().toISOString()} [SLOW] messenger=${messenger} ${details} обработка заняла ${elapsed}мс`,
	);
}
