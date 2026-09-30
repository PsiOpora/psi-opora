import { createRedisClient } from "@psi-opora/bot-core";
import { z } from "zod";
import {
	DEFAULT_CONNECT_TIMEOUT_MS,
	DEFAULT_REQUEST_TIMEOUT_MS,
} from "./protocol/client";

/**
 * Передача шагов входа в личный MAX от дашборда (packages/api) воркеру
 * (apps/max-userbot-worker) через Redis. Вход обязан идти на одном
 * TLS-соединении (см. MaxLoginFlow в login.ts), а держать его между
 * HTTP-запросами может только always-on воркер. Схема как у outbox.ts:
 * дашборд кладёт команду в список, воркер забирает её и пишет ответ в
 * отдельный ключ по requestId, дашборд опрашивает этот ключ.
 *
 * Секреты в Redis открытым текстом не лежат: пароль дашборд шифрует, а
 * готовую сессию — воркер (encryptSecret, общий TG_USERBOT_ENCRYPTION_KEY).
 *
 * Рассчитано на одну реплику воркера (он и так держит по одному соединению
 * на каждый подключённый номер): вход живёт в памяти процесса, который
 * выполнил команду `start`. После рестарта воркера незавершённый вход
 * теряется, и человек запрашивает код заново.
 */

const COMMANDS_KEY = "max-userbot:login:commands";
const replyKey = (requestId: string) => `max-userbot:login:reply:${requestId}`;

const REPLY_TTL_SECONDS = 120;
const REPLY_POLL_INTERVAL_MS = 250;
/** Запас на доставку ответа и ожидание в очереди. */
const REPLY_BUDGET_MS = 1_000;
const QUEUE_BUDGET_MS = 4_000;

const commandSchema = z.discriminatedUnion("action", [
	z.object({ action: z.literal("start"), phone: z.string().min(1) }),
	z.object({ action: z.literal("code"), code: z.string().min(1) }),
	z.object({
		action: z.literal("password"),
		passwordEncrypted: z.string().min(1),
	}),
	z.object({ action: z.literal("cancel") }),
]);
export type MaxLoginCommand = z.infer<typeof commandSchema>;

function executionBudgetMs(command: MaxLoginCommand): number {
	switch (command.action) {
		case "start":
			return DEFAULT_CONNECT_TIMEOUT_MS + 2 * DEFAULT_REQUEST_TIMEOUT_MS;
		case "code":
		case "password":
			return DEFAULT_REQUEST_TIMEOUT_MS;
		case "cancel":
			return 0;
	}
}

/** Проверяется до публикации и после ожидания в очереди одного входа. */
export function assertMaxLoginCommandDeadline(
	command: MaxLoginCommand,
	expiresAt: number,
): void {
	if (expiresAt - Date.now() < executionBudgetMs(command) + REPLY_BUDGET_MS) {
		throw new Error(
			"Недостаточно времени для шага входа в MAX — повторите попытку",
		);
	}
}

const queuedCommandSchema = z.object({
	requestId: z.string().min(1),
	loginId: z.string().min(1),
	/** Unix-время (мс), после которого дашборд уже не ждёт ответа — такую
	 * команду воркер пропускает, чтобы не отправлять код «в пустоту». */
	expiresAt: z.number(),
	command: commandSchema,
});
export type QueuedMaxLoginCommand = z.infer<typeof queuedCommandSchema>;

export type MaxLoginStepResult =
	| { status: "code_sent"; phone: string; codeLength: number }
	| { status: "password_required"; hint?: string; email?: string }
	/** sessionEncrypted — готово для записи в БД (sessionEncrypted колонки). */
	| { status: "connected"; sessionEncrypted: string }
	| { status: "cancelled" };

export type MaxLoginReply =
	| { ok: true; result: MaxLoginStepResult }
	| { ok: false; error: string };

const delay = (milliseconds: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** Сторона дашборда: отправляет шаг воркеру и ждёт результат. */
export async function callMaxLoginWorker(
	loginId: string,
	command: MaxLoginCommand,
	timeoutMs = executionBudgetMs(command) + REPLY_BUDGET_MS + QUEUE_BUDGET_MS,
): Promise<MaxLoginStepResult> {
	const deadline = Date.now() + timeoutMs;
	assertMaxLoginCommandDeadline(command, deadline);
	const redis = createRedisClient();
	const requestId = crypto.randomUUID();
	const queued: QueuedMaxLoginCommand = {
		requestId,
		loginId,
		expiresAt: deadline,
		command,
	};
	await redis.rpush(COMMANDS_KEY, queued);

	while (Date.now() < deadline) {
		const reply = await redis.get<MaxLoginReply>(replyKey(requestId));
		if (reply) {
			await redis.del(replyKey(requestId));
			if (!reply.ok) throw new Error(reply.error);
			return reply.result;
		}
		await delay(REPLY_POLL_INTERVAL_MS);
	}
	throw new Error(
		"Воркер личных номеров MAX не ответил — проверьте, что max-userbot-worker запущен, и попробуйте ещё раз",
	);
}

/** Сторона воркера: следующая команда из очереди. Битые записи логируются
 * и пропускаются, просроченные — молча отбрасываются. */
export async function claimMaxLoginCommand(): Promise<QueuedMaxLoginCommand | null> {
	const redis = createRedisClient();
	for (;;) {
		const raw = await redis.lpop<unknown>(COMMANDS_KEY);
		if (raw === null) return null;
		const parsed = queuedCommandSchema.safeParse(raw);
		if (!parsed.success) {
			console.error(
				`[max-personal-login] пропущена некорректная команда входа: ${parsed.error.message}`,
			);
			continue;
		}
		if (parsed.data.expiresAt <= Date.now()) continue;
		return parsed.data;
	}
}

export async function replyMaxLoginCommand(
	requestId: string,
	reply: MaxLoginReply,
): Promise<void> {
	await createRedisClient().set(replyKey(requestId), reply, {
		ex: REPLY_TTL_SECONDS,
	});
}
