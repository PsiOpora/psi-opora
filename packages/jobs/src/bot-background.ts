import {
	ConcurrencyLimitStrategy,
	CreateTaskWorkflow,
} from "@hatchet-dev/typescript-sdk/v1";
import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import {
	type BotBackgroundTask,
	runBotBackgroundTask,
} from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import { getHatchetClient } from "./hatchet/client";

/**
 * Фоновые задачи ботов (tg-bot, max-bot). Отдельная точка входа пакета
 * (@psi-opora/jobs/bot-background), чтобы боты не тянули остальные задачи
 * (бэкапы, рассылки, сертификаты) ради одной постановки в очередь.
 */

/**
 * Payload в Hatchet должен быть строго JSON (без undefined), поэтому задача
 * передаётся строкой; chatKey вынесен отдельно — по нему считается
 * concurrency. Payload ставит в очередь только сам бот.
 */
export type BotBackgroundPayload = { chatKey: string; task: string };

function parseTask(payload: BotBackgroundPayload): BotBackgroundTask {
	return JSON.parse(payload.task) as BotBackgroundTask;
}

// Одна задача на чат за раз: сообщения одного клиента доходят до оператора
// по порядку, а обогащение CRM не создаёт два контакта параллельно.
const PER_CHAT = {
	expression: "input.chatKey",
	maxRuns: 1,
	limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
};

function bitrixApi() {
	return env.BITRIX_MEMBER_ID
		? (resolveBitrixApi(env.BITRIX_MEMBER_ID) ?? undefined)
		: undefined;
}

/**
 * Повторная доставка сообщения клиента в Открытую линию, если отправка из
 * бота не удалась (Bitrix недоступен). Внешний ID и время сообщения
 * зафиксированы при постановке — повтор идёт с теми же, что и первая попытка.
 */
export const botOpenLineRetry = CreateTaskWorkflow({
	name: "bot-openline-retry",
	// 2, 4, … 512 с, дальше по 15 минут — всего около часа.
	retries: 12,
	backoff: { factor: 2, maxSeconds: 900 },
	executionTimeout: "1m",
	scheduleTimeout: "24h",
	concurrency: PER_CHAT,
	fn: async (payload: BotBackgroundPayload) => {
		await runBotBackgroundTask(parseTask(payload), { bitrixApi: bitrixApi() });
	},
});

/**
 * Обогащение CRM из сообщения клиента и триаж сообщений не по сценарию
 * (LLM + Bitrix). Без ретраев: обе функции сами глотают ошибки, а повтор
 * означал бы второй вызов LLM и риск дубля контакта.
 */
export const botMessageAnalysis = CreateTaskWorkflow({
	name: "bot-message-analysis",
	retries: 0,
	executionTimeout: "2m",
	scheduleTimeout: "1h",
	concurrency: PER_CHAT,
	fn: async (payload: BotBackgroundPayload) => {
		await runBotBackgroundTask(parseTask(payload), { bitrixApi: bitrixApi() });
	},
});

export const botBackgroundTasks = [botOpenLineRetry, botMessageAnalysis];

/** Hatchet настроен — иначе боты выполняют задачи сами (см. createBotBackgroundQueue). */
export function isHatchetConfigured(): boolean {
	return Boolean(env.HATCHET_CLIENT_TOKEN);
}

export async function enqueueBotBackgroundTask(
	task: BotBackgroundTask,
): Promise<void> {
	const workflow =
		task.type === "openline" ? botOpenLineRetry : botMessageAnalysis;
	await getHatchetClient().runNoWait(workflow, {
		chatKey: task.chatKey,
		task: JSON.stringify(task),
	});
}
