import {
	type BitrixApiLike,
	deliverMessageToOpenLine,
	type OpenLineDeliveryKind,
	type OpenLineMessageData,
} from "./bitrix";
import {
	type CrmEnrichmentMessage,
	enrichCrmFromClientMessage,
} from "./crm-enrichment";
import { withTimeout } from "./timeout";
import { type TriageMessage, triageOffScriptMessage } from "./triage";

/**
 * Работа по сообщению клиента, которая не нужна для ответа бота. chatKey —
 * тот же ключ, что у лока чата (`telegram:<chatId>`, `max:<userId>`): по нему
 * задачи одного чата выполняются строго по очереди — и в процессе бота, и в
 * Hatchet (concurrency по input.chatKey).
 */
export type BotBackgroundTask =
	| {
			type: "openline";
			chatKey: string;
			kind: OpenLineDeliveryKind;
			data: OpenLineMessageData;
	  }
	| { type: "crm-enrichment"; chatKey: string; message: CrmEnrichmentMessage }
	| { type: "triage"; chatKey: string; message: TriageMessage };

/** Постановка задачи в Hatchet (@psi-opora/jobs/bot-background). */
export type EnqueueBotTask = (task: BotBackgroundTask) => Promise<unknown>;

export interface BotBackgroundDeps {
	bitrixApi?: BitrixApiLike;
	enrichCrm?: typeof enrichCrmFromClientMessage;
}

const OPENLINE_TIMEOUT_MS = 15_000;

/**
 * Выполняет задачу. Для Открытой линии бросает ошибку, чтобы Hatchet повторил
 * доставку; обогащение CRM и триаж сами глотают свои ошибки — их повтор
 * (второй вызов LLM, второй контакт в Bitrix) опаснее пропуска.
 */
export async function runBotBackgroundTask(
	task: BotBackgroundTask,
	deps: BotBackgroundDeps,
): Promise<void> {
	switch (task.type) {
		case "openline":
			await withTimeout(
				deliverMessageToOpenLine(deps.bitrixApi, task.data, task.kind),
				OPENLINE_TIMEOUT_MS,
				"imconnector",
			);
			return;
		case "crm-enrichment":
			await (deps.enrichCrm ?? enrichCrmFromClientMessage)(task.message);
			return;
		case "triage":
			await triageOffScriptMessage(task.message);
			return;
	}
}

export interface BotBackgroundQueue {
	/** Пересылка сообщения клиента в Открытую линию — без ожидания. */
	mirrorToOpenLine(
		chatKey: string,
		kind: OpenLineDeliveryKind,
		data: OpenLineMessageData,
	): void;
	/** Обогащение CRM / триаж — без ожидания, после пересылки этого чата. */
	analyze(task: Exclude<BotBackgroundTask, { type: "openline" }>): void;
	/**
	 * Дожидается пересылки уже принятых сообщений чата. Нужно перед созданием
	 * контакта/сделки и поиском контакта по диалогу: диалог Открытой линии
	 * появляется в Bitrix только с первым пересланным сообщением.
	 */
	waitForOpenLine(chatKey: string): Promise<void>;
	/** Дожидается всех задач (graceful shutdown пода). */
	drain(timeoutMs: number): Promise<void>;
}

const ENQUEUE_TIMEOUT_MS = 5_000;
const WAIT_OPENLINE_TIMEOUT_MS = 20_000;

/**
 * Очередь фоновой работы бота. Открытая линия пересылается прямо из процесса
 * (так оператор видит сообщение быстрее, чем через Hatchet), а в Hatchet
 * уходит только неудавшаяся доставка — там она повторяется с backoff и
 * переживает перезапуск пода. Обогащение CRM и триаж (LLM, Bitrix) целиком
 * уходят в Hatchet; без него (локальная разработка, тесты, сбой постановки)
 * выполняются здесь же, в фоне.
 */
export function createBotBackgroundQueue(
	deps: BotBackgroundDeps & {
		enqueue?: EnqueueBotTask;
		/** Подмена исполнителя задач в тестах. */
		runTask?: (task: BotBackgroundTask) => Promise<void>;
	},
): BotBackgroundQueue {
	const run = deps.runTask ?? ((task) => runBotBackgroundTask(task, deps));
	const openLineTails = new Map<string, Promise<void>>();
	const analysisTails = new Map<string, Promise<void>>();

	const chain = (
		tails: Map<string, Promise<void>>,
		key: string,
		fn: () => Promise<void>,
	) => {
		const next = (tails.get(key) ?? Promise.resolve()).then(fn).catch((err) => {
			console.error(
				`[background] ${key}: ${(err as Error).message ?? String(err)}`,
			);
		});
		tails.set(key, next);
		void next.finally(() => {
			if (tails.get(key) === next) tails.delete(key);
		});
	};

	const enqueue = async (task: BotBackgroundTask): Promise<boolean> => {
		if (!deps.enqueue) return false;
		try {
			await withTimeout(deps.enqueue(task), ENQUEUE_TIMEOUT_MS, "hatchet");
			return true;
		} catch (err) {
			console.error(
				`[background] не удалось поставить ${task.type} для ${task.chatKey} в Hatchet: ${(err as Error).message}`,
			);
			return false;
		}
	};

	const waitForOpenLine = async (chatKey: string) => {
		const tail = openLineTails.get(chatKey);
		if (!tail) return;
		await withTimeout(tail, WAIT_OPENLINE_TIMEOUT_MS, "openline").catch(
			() => {},
		);
	};

	return {
		mirrorToOpenLine(chatKey, kind, data) {
			// Фиксируем время и внешний ID сейчас: при повторе из Hatchet
			// сообщение должно прийти с исходными, а не с новыми значениями.
			const task: BotBackgroundTask = {
				type: "openline",
				chatKey,
				kind,
				data: {
					...data,
					date: data.date ?? Math.floor(Date.now() / 1000),
					externalId:
						data.externalId ??
						(data.messageId == null
							? `${data.messenger}-${data.userId}-${Date.now()}`
							: undefined),
				},
			};
			chain(openLineTails, chatKey, async () => {
				try {
					await run(task);
				} catch (err) {
					console.error(
						`[bitrix] не удалось переслать сообщение ${chatKey} в Открытую линию: ${(err as Error).message}`,
					);
					if (!(await enqueue(task))) {
						console.error(
							`[bitrix] сообщение ${chatKey} не попало в Открытую линию и не поставлено на повтор`,
						);
					}
				}
			});
		},

		analyze(task) {
			const openLineDone = waitForOpenLine(task.chatKey);
			chain(analysisTails, task.chatKey, async () => {
				await openLineDone;
				if (await enqueue(task)) return;
				await run(task);
			});
		},

		waitForOpenLine,

		async drain(timeoutMs) {
			const pending = [...openLineTails.values(), ...analysisTails.values()];
			if (!pending.length) return;
			await withTimeout(
				Promise.allSettled(pending),
				timeoutMs,
				"background drain",
			).catch((err) => console.error(`[background] ${(err as Error).message}`));
		},
	};
}
