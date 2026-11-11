/**
 * Отправка созревших отложенных сообщений раз в минуту — таймером внутри
 * процесса apps/hatchet-worker, а не кроном Hatchet: ежеминутный крон один
 * съедал 1440 запусков из суточного лимита Hatchet Cloud, а очередь такому
 * опросу базы не нужна.
 *
 * Сама логика отправки живёт в @psi-opora/api (тот же код, что и у обычной
 * отправки из инбокса и вкладки CRM), а api зависит от jobs — поэтому
 * обработчик передаёт процесс воркера при старте.
 */
export type ScheduledMessagesDispatcher = () => Promise<Record<string, number>>;

export type ScheduledMessagesTicker = {
	/** Останавливает таймер и дожидается текущей отправки. */
	stop: () => Promise<void>;
};

const TICK_INTERVAL_MS = 60 * 1000;
// Отправка сама ограничена бюджетом в несколько минут; запуск дольше этого —
// зависший вызов мессенджера. Блокировку снимаем, чтобы он не остановил
// рассылку навсегда (сообщения не задвоятся: claim атомарный).
const STUCK_AFTER_MS = 10 * 60 * 1000;

export function startScheduledMessagesTicker(
	dispatch: ScheduledMessagesDispatcher,
	options: { intervalMs?: number; stuckAfterMs?: number } = {},
): ScheduledMessagesTicker {
	const intervalMs = options.intervalMs ?? TICK_INTERVAL_MS;
	const stuckAfterMs = options.stuckAfterMs ?? STUCK_AFTER_MS;
	let current: { promise: Promise<void>; startedAt: number } | null = null;

	const tick = () => {
		if (current) {
			// Один запуск за раз: следующая минута не должна стартовать поверх
			// затянувшейся отправки — личные номера не должны получать
			// параллельную нагрузку.
			if (Date.now() - current.startedAt < stuckAfterMs) return;
			console.error(
				`[scheduled-messages] отправка не завершилась за ${Math.round(stuckAfterMs / 60000)} мин — запускаем следующую`,
			);
		}
		const run = {
			startedAt: Date.now(),
			promise: Promise.resolve()
				.then(dispatch)
				.then(
					(result) => {
						if (Object.values(result).some((count) => count > 0)) {
							console.info("[scheduled-messages] завершено", result);
						}
					},
					(err) => {
						console.error(
							`[scheduled-messages] сбой запуска: ${err instanceof Error ? err.message : String(err)}`,
						);
					},
				)
				.finally(() => {
					if (current === run) current = null;
				}),
		};
		current = run;
	};

	const timer = setInterval(tick, intervalMs);
	// Сразу после старта: добираем то, что созрело за время перезапуска.
	tick();

	return {
		stop: async () => {
			clearInterval(timer);
			await current?.promise;
		},
	};
}
