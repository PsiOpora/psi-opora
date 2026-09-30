import {
	claimMaxLoginCommand,
	decryptSecret,
	encryptSecret,
	MaxLoginFlow,
	type MaxLoginStepResult,
	type QueuedMaxLoginCommand,
	replyMaxLoginCommand,
} from "@psi-opora/max-userbot";

/**
 * Незавершённые входы в личный MAX: соединение каждого живёт здесь, пока
 * дашборд проводит человека через код и облачный пароль (см.
 * packages/max-userbot/src/login-broker.ts). TTL совпадает с временем жизни
 * pending-логина в Redis на стороне API (max-personal/helpers.ts).
 */
const LOGIN_TTL_MS = 10 * 60_000;
const COMMAND_POLL_INTERVAL_MS = 500;

interface ActiveLogin {
	flow: MaxLoginFlow;
	expiryTimer: ReturnType<typeof setTimeout>;
}

const activeLogins = new Map<string, ActiveLogin>();
/** Шаги одного входа выполняются строго по очереди. */
const loginQueues = new Map<string, Promise<void>>();

const delay = (milliseconds: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function disposeLogin(loginId: string): void {
	const login = activeLogins.get(loginId);
	if (!login) return;
	clearTimeout(login.expiryTimer);
	login.flow.close();
	activeLogins.delete(loginId);
}

function registerLogin(loginId: string, flow: MaxLoginFlow): void {
	disposeLogin(loginId);
	activeLogins.set(loginId, {
		flow,
		expiryTimer: setTimeout(() => {
			console.log(`[max-personal-login] вход ${loginId} истёк по TTL`);
			disposeLogin(loginId);
		}, LOGIN_TTL_MS),
	});
}

function requireLogin(loginId: string): ActiveLogin {
	const login = activeLogins.get(loginId);
	if (!login) {
		throw new Error(
			"Вход в MAX прервался (истёк или воркер перезапускался) — запросите код заново",
		);
	}
	return login;
}

async function executeCommand(
	queued: QueuedMaxLoginCommand,
): Promise<MaxLoginStepResult> {
	const { loginId, command } = queued;
	switch (command.action) {
		case "start": {
			const { flow, result } = await MaxLoginFlow.start(command.phone);
			registerLogin(loginId, flow);
			return result;
		}
		case "code": {
			const login = requireLogin(loginId);
			const result = await login.flow.submitCode(command.code);
			if (result.status === "password_required") return result;
			disposeLogin(loginId);
			return {
				status: "connected",
				sessionEncrypted: encryptSecret(result.session),
			};
		}
		case "password": {
			const login = requireLogin(loginId);
			const result = await login.flow.submitPassword(
				decryptSecret(command.passwordEncrypted),
			);
			disposeLogin(loginId);
			return {
				status: "connected",
				sessionEncrypted: encryptSecret(result.session),
			};
		}
		case "cancel":
			disposeLogin(loginId);
			return { status: "cancelled" };
	}
}

async function handleCommand(queued: QueuedMaxLoginCommand): Promise<void> {
	const { requestId, loginId, command } = queued;
	console.log(
		`[max-personal-login] шаг входа ${command.action}: loginId=${loginId}`,
	);
	try {
		const result = await executeCommand(queued);
		await replyMaxLoginCommand(requestId, { ok: true, result });
	} catch (error) {
		const message = (error as Error).message;
		console.error(
			`[max-personal-login] шаг входа ${command.action} не удался: loginId=${loginId}: ${message}`,
		);
		// Неверный код/пароль оставляет вход живым — можно ввести ещё раз;
		// оборванное соединение — нет.
		if (activeLogins.get(loginId)?.flow.connectionLost) disposeLogin(loginId);
		await replyMaxLoginCommand(requestId, { ok: false, error: message }).catch(
			(replyError) =>
				console.error(
					`[max-personal-login] не удалось отправить ответ дашборду: ${(replyError as Error).message}`,
				),
		);
	}
}

function enqueue(queued: QueuedMaxLoginCommand): void {
	const previous = loginQueues.get(queued.loginId) ?? Promise.resolve();
	const next = previous.then(() => handleCommand(queued));
	loginQueues.set(queued.loginId, next);
	void next.finally(() => {
		if (loginQueues.get(queued.loginId) === next)
			loginQueues.delete(queued.loginId);
	});
}

export async function runLoginBroker(): Promise<never> {
	for (;;) {
		try {
			const queued = await claimMaxLoginCommand();
			if (queued) {
				enqueue(queued);
				continue;
			}
		} catch (error) {
			console.error(
				`[max-personal-login] ошибка чтения очереди входа: ${(error as Error).message}`,
			);
		}
		await delay(COMMAND_POLL_INTERVAL_MS);
	}
}
