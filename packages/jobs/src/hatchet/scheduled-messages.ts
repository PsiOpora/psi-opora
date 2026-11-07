import {
	ConcurrencyLimitStrategy,
	CreateTaskWorkflow,
} from "@hatchet-dev/typescript-sdk/v1";

/**
 * Отправка созревших отложенных сообщений. Сама логика отправки живёт в
 * @psi-opora/api (тот же код, что и у обычной отправки из инбокса и вкладки
 * CRM), а api зависит от jobs — поэтому напрямую jobs её вызвать не может.
 * Процесс воркера (apps/hatchet-worker) регистрирует обработчик при старте.
 */
export type ScheduledMessagesDispatcher = () => Promise<Record<string, number>>;

let dispatcher: ScheduledMessagesDispatcher | null = null;

export function setScheduledMessagesDispatcher(
	fn: ScheduledMessagesDispatcher,
): void {
	dispatcher = fn;
}

export const scheduledMessagesDispatch = CreateTaskWorkflow({
	name: "scheduled-messages-dispatch",
	on: { cron: "* * * * *" },
	retries: 0,
	executionTimeout: "10m",
	// Один запуск за раз: следующая минута не должна стартовать поверх
	// затянувшейся отправки (сообщения и так не задвоятся, но личные номера
	// не должны получать параллельную нагрузку).
	concurrency: {
		expression: "'scheduled-messages-dispatch'",
		maxRuns: 1,
		limitStrategy: ConcurrencyLimitStrategy.CANCEL_NEWEST,
	},
	fn: async () => {
		if (!dispatcher) {
			// Воркер запущен без api (например, `bun run dev` в packages/jobs).
			console.warn(
				"[scheduled-messages] обработчик не зарегистрирован — пропускаем запуск",
			);
			return { skipped: true };
		}
		return await dispatcher();
	},
});
