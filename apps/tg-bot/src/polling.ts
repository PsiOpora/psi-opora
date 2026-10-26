import {
	createConcurrentSink,
	createRunner,
	createSource,
	createUpdateFetcher,
	type UpdateSupplier,
} from "@grammyjs/runner";
import type { RedisClient } from "@psi-opora/bot-core";
import { type Bot, type BotError, type Context, GrammyError } from "grammy";
import type { Update } from "grammy/types";

/** Пауза перед повтором getUpdates после 409 или затяжного сбоя сети. */
const RETRY_DELAY_MS = 5_000;
// Сколько fetcher grammY сам молча ретраит сетевые ошибки, прежде чем отдать
// её нам: дольше — и затяжной обрыв связи с Telegram (3proxy) не был бы виден
// в логах. Дефолт runner — 15 часов.
const MAX_SILENT_RETRY_MS = 5 * 60_000;
// Повторная доставка апдейта возможна только в окне перезапуска/выкатки —
// суток с запасом хватает, ключи потом истекают сами.
const DEDUPE_TTL_SECONDS = 24 * 60 * 60;
// Сколько Telegram держит getUpdates без новых апдейтов. Должно быть меньше
// timeoutSeconds клиента grammY (15 с в createBot) — он распространяется и на
// getUpdates, и с дефолтными 30 с runner каждый пустой опрос падал бы по
// таймауту.
const LONG_POLL_TIMEOUT_SECONDS = 10;

export interface PollingHandle {
	/** Завершается с ошибкой, только если опрос невозможно продолжить (401). */
	task: Promise<void>;
	/**
	 * Перестаёт забирать апдейты, ждёт обработки уже полученных (не дольше
	 * timeoutMs) и подтверждает их Telegram, чтобы следующий экземпляр бота
	 * не получил их повторно.
	 */
	stop(timeoutMs: number): Promise<void>;
}

// Сигнал runner — полифилл abort-controller, а не DOM AbortSignal (у него нет
// reason), поэтому берём только то, что есть у обоих.
type StopSignal = Pick<
	AbortSignal,
	"aborted" | "addEventListener" | "removeEventListener"
>;

function sleep(ms: number, signal?: StopSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(new Error("polling остановлен"));
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(new Error("polling остановлен"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * Запускает бота в режиме long polling (getUpdates) — сервер сам забирает
 * апдейты у Telegram, публичный адрес и входящий вебхук не нужны.
 *
 * Апдейты обрабатываются параллельно (@grammyjs/runner), как раньше при
 * вебхуке, где каждый апдейт был отдельным HTTP-запросом: штатный bot.start()
 * обрабатывает их строго по одному, и долгая пересылка голосового в Открытую
 * линию задерживала бы ответы всем клиентам. Порядок внутри одного чата
 * по-прежнему держит withUserLock в createBot.
 *
 * Поверх стандартного run() из runner:
 * - 409 Conflict (второй экземпляр во время выкатки k8s или кто-то выставил
 *   вебхук) не останавливает опрос — ждём и повторяем с тем же offset, а
 *   вебхук снимаем сами: в этом режиме он всегда лишний;
 * - при остановке подтверждаем последний полученный апдейт (как bot.stop() в
 *   grammY — runner этого не делает), иначе он придёт заново после рестарта;
 * - повторно доставленные апдейты (пересечение старого и нового пода при
 *   выкатке) отсеиваются по update_id через Redis.
 */
export async function startPolling<C extends Context>(
	bot: Bot<C>,
	redis: RedisClient,
): Promise<PollingHandle> {
	await bot.init();
	// Пока вебхук выставлен, getUpdates отвечает 409. Накопившиеся апдейты не
	// сбрасываем — они придут в первом же getUpdates.
	await bot.api.deleteWebhook({ drop_pending_updates: false });

	const fetchUpdates = createUpdateFetcher(bot, {
		fetch: { timeout: LONG_POLL_TIMEOUT_SECONDS },
		maxRetryTime: MAX_SILENT_RETRY_MS,
		silent: true,
	});
	let lastUpdateId: number | undefined;

	const supplier: UpdateSupplier<Update> = {
		async supply(batchSize, signal) {
			for (;;) {
				try {
					const updates = await fetchUpdates(batchSize, signal);
					const last = updates.at(-1);
					if (last) lastUpdateId = last.update_id;
					return updates;
				} catch (err) {
					if (signal.aborted) throw err;
					const apiErr = err instanceof GrammyError ? err : undefined;
					// Токен отозван/неверный — повторять бессмысленно.
					if (apiErr?.error_code === 401) throw err;
					if (apiErr?.error_code !== 409) {
						console.error("[BOT] getUpdates не удаётся:", err);
					} else if (apiErr.description.includes("webhook")) {
						console.warn("[BOT] у бота выставлен вебхук — снимаем его");
						await bot.api
							.deleteWebhook({ drop_pending_updates: false })
							.catch((deleteErr) =>
								console.error("[BOT] не удалось снять вебхук:", deleteErr),
							);
					} else {
						console.warn(
							"[BOT] getUpdates: апдейты забирает другой экземпляр бота (нормально во время выкатки)",
						);
					}
					await sleep(RETRY_DELAY_MS, signal);
				}
			}
		},
	};

	const dedupeKeyPrefix = `tg:update:${bot.botInfo.id}:`;
	const sink = createConcurrentSink<Update>(
		{
			consume: async (update) => {
				const fresh = await redis
					.set(`${dedupeKeyPrefix}${update.update_id}`, 1, {
						nx: true,
						ex: DEDUPE_TTL_SECONDS,
					})
					// Redis недоступен — лучше обработать апдейт, чем потерять его.
					.catch(() => "OK" as const);
				if (!fresh) {
					console.warn(
						`[BOT] update_id=${update.update_id} уже обработан — пропускаем`,
					);
					return;
				}
				await bot.handleUpdate(update);
			},
		},
		async (error) => {
			try {
				await bot.errorHandler(error as BotError<C>);
			} catch (handlerErr) {
				console.error("[BOT] ошибка обработки апдейта:", handlerErr);
			}
		},
	);

	const runner = createRunner(createSource(supplier), sink);
	runner.start();
	const task = runner.task() ?? Promise.resolve();

	return {
		task,
		async stop(timeoutMs) {
			const deadline = Date.now() + timeoutMs;
			await runner.stop();
			while (runner.size() > 0 && Date.now() < deadline) {
				await sleep(100);
			}
			if (lastUpdateId === undefined) return;
			await bot.api
				.getUpdates({ offset: lastUpdateId + 1, limit: 1, timeout: 0 })
				.catch((err) =>
					console.warn("[BOT] не удалось подтвердить последние апдейты:", err),
				);
		},
	};
}
