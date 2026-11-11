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
/**
 * Обработчик одного запуска. signal срабатывает, когда запуск признан зависшим
 * и заменён следующим: новые отправки после этого начинать нельзя.
 */
export type ScheduledMessagesDispatcher = (
	signal: AbortSignal,
) => Promise<Record<string, number>>;

export type ScheduledMessagesTicker = {
	/** Останавливает таймер и дожидается всех незавершённых отправок. */
	stop: () => Promise<void>;
};

type Run = {
	startedAt: number;
	abort: AbortController;
	promise: Promise<void>;
};

const TICK_INTERVAL_MS = 60 * 1000;
// Отправка сама ограничена бюджетом в несколько минут; запуск дольше этого —
// зависший вызов мессенджера. Блокировку снимаем, чтобы он не остановил
// рассылку навсегда (сообщения не задвоятся: claim атомарный).
const STUCK_AFTER_MS = 10 * 60 * 1000;

/**
 * Запускает таймер рассылки: первый запуск сразу, дальше раз в intervalMs.
 * Один запуск за раз; запуск дольше stuckAfterMs получает сигнал отмены и
 * уступает место следующему.
 */
export function startScheduledMessagesTicker(
	dispatch: ScheduledMessagesDispatcher,
	options: { intervalMs?: number; stuckAfterMs?: number } = {},
): ScheduledMessagesTicker {
	const intervalMs = options.intervalMs ?? TICK_INTERVAL_MS;
	const stuckAfterMs = options.stuckAfterMs ?? STUCK_AFTER_MS;
	let current: Run | null = null;
	// Все незавершённые запуски, включая заменённые после зависания: stop()
	// должен дождаться и их, иначе process.exit оборвёт отправку на полпути.
	const active = new Set<Run>();

	const tick = () => {
		if (current) {
			// Один запуск за раз: следующая минута не должна стартовать поверх
			// затянувшейся отправки — личные номера не должны получать
			// параллельную нагрузку.
			if (Date.now() - current.startedAt < stuckAfterMs) return;
			console.error(
				`[scheduled-messages] отправка не завершилась за ${Math.round(stuckAfterMs / 60000)} мин — запускаем следующую`,
			);
			// Зависший запуск, очнувшись, не должен досылать остаток пачки:
			// следующий запуск мог уже пометить эти сообщения ошибкой.
			current.abort.abort();
		}
		const abort = new AbortController();
		const run: Run = {
			startedAt: Date.now(),
			abort,
			promise: Promise.resolve()
				.then(() => dispatch(abort.signal))
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
					active.delete(run);
					if (current === run) current = null;
				}),
		};
		active.add(run);
		current = run;
	};

	const timer = setInterval(tick, intervalMs);
	// Сразу после старта: добираем то, что созрело за время перезапуска.
	tick();

	return {
		stop: async () => {
			clearInterval(timer);
			await Promise.all([...active].map((run) => run.promise));
		},
	};
}
