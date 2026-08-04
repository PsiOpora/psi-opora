import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import {
	insertBotMessage,
	listConnectedMaxPersonalAccounts,
	markMaxPersonalAccountError,
	type MaxPersonalAccount,
	updateBotMessageExternalResult,
	upsertBotUser,
} from "@psi-opora/db/queries";
import {
	ackMaxOutboundMessage,
	claimMaxOutboundMessage,
	createUserbotClient,
	decryptSecret,
	deleteUserbotMessage,
	type MaxProtocolClient,
	recoverMaxOutboundMessages,
	sendUserbotMessage,
	setMaxSendResult,
} from "@psi-opora/max-userbot";

const OUTBOX_POLL_INTERVAL_MS = 3000;
const ACCOUNTS_RESCAN_INTERVAL_MS = 5000;
const MAX_RECONNECT_DELAY_MS = 60_000;

interface AccountRuntime {
	key: string;
	account: MaxPersonalAccount;
	client: MaxProtocolClient | null;
	connecting: boolean;
	stopped: boolean;
	retryAttempt: number;
	retryTimer?: ReturnType<typeof setTimeout>;
	outboxLoop?: Promise<void>;
}

const runtimes = new Map<string, AccountRuntime>();

const accountKey = (account: MaxPersonalAccount) =>
	`${account.memberId}:${account.openLineId}:${account.connectorId}`;
const accountLabel = (account: MaxPersonalAccount) =>
	`${account.memberId}:${account.openLineId} (${account.phone})`;
const delay = (milliseconds: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function isPermanentAuthError(error: Error): boolean {
	return /отклонил вход|invalid.{0,20}token|token.{0,20}(invalid|expired)|session.{0,20}(invalid|expired)|unauthori[sz]ed|access.{0,10}denied|auth.{0,20}fail/i.test(
		error.message,
	);
}

async function logInboundMessage(
	account: MaxPersonalAccount,
	chatId: string,
	text: string,
	externalId: string | null,
): Promise<void> {
	try {
		await upsertBotUser({ messenger: "max-personal", userId: chatId });
		await insertBotMessage({
			messenger: "max-personal",
			userId: chatId,
			direction: "in",
			source: "scenario",
			text,
			externalId: externalId ?? undefined,
			connectorId: account.connectorId,
		});
	} catch (error) {
		console.error(
			`[max-userbot-worker] ошибка журналирования: ${(error as Error).message}`,
		);
	}
}

async function relayInboundMessage(
	account: MaxPersonalAccount,
	message: {
		chatId: string;
		senderId: string | null;
		messageId: string | null;
		text: string;
	},
): Promise<void> {
	if (!message.chatId || message.senderId === null || !message.text) return;
	const api = resolveBitrixApi(account.memberId);
	if (!api) return;
	try {
		await api.call("imconnector.send.messages", {
			CONNECTOR: account.connectorId,
			LINE: Number(account.openLineId),
			MESSAGES: [
				{
					user: { id: message.chatId, skip_phone_validate: "Y" },
					message: {
						id:
							message.messageId ??
							`max-personal-${message.senderId}-${Date.now()}`,
						date: Math.floor(Date.now() / 1000),
						text: message.text,
					},
					chat: {
						id: message.chatId,
						name: `MAX #${message.senderId}`,
					},
				},
			],
		});
	} catch (error) {
		console.error(
			`[max-userbot-worker] ошибка пересылки в Открытую линию (${accountLabel(account)}): ${(error as Error).message}`,
		);
	}
}

async function runOutbox(
	runtime: AccountRuntime,
	client: MaxProtocolClient,
): Promise<void> {
	const { account } = runtime;
	while (!runtime.stopped && runtime.client === client) {
		const claimed = await claimMaxOutboundMessage(
			account.memberId,
			account.openLineId,
			account.connectorId,
		);
		if (!claimed) {
			await delay(OUTBOX_POLL_INTERVAL_MS);
			continue;
		}

		const { message, receipt } = claimed;
		try {
			if (message.action === "delete") {
				if (!message.externalId) throw new Error("Не задан externalId");
				await deleteUserbotMessage(client, message.chatId, message.externalId);
				await setMaxSendResult(message.jobId, { ok: true });
			} else {
				if (!message.text) throw new Error("Не задан текст сообщения");
				const externalId = await sendUserbotMessage(
					client,
					message.chatId,
					message.text,
				);
				if (message.journalMessageId) {
					await updateBotMessageExternalResult(
						message.journalMessageId,
						externalId,
						"sent",
					);
				}
				await setMaxSendResult(message.jobId, { ok: true, externalId });
			}
		} catch (error) {
			const errorMessage = (error as Error).message;
			if (message.journalMessageId) {
				await updateBotMessageExternalResult(
					message.journalMessageId,
					undefined,
					"failed",
				).catch(() => {});
			}
			await setMaxSendResult(message.jobId, {
				ok: false,
				error: errorMessage,
			}).catch(() => {});
		} finally {
			await ackMaxOutboundMessage(message, receipt);
		}
	}
}

function scheduleReconnect(runtime: AccountRuntime): void {
	if (runtime.stopped || runtime.retryTimer) return;
	const milliseconds = Math.min(
		5000 * 2 ** runtime.retryAttempt,
		MAX_RECONNECT_DELAY_MS,
	);
	runtime.retryAttempt += 1;
	console.error(
		`[max-userbot-worker] переподключение ${accountLabel(runtime.account)} через ${milliseconds / 1000} секунд`,
	);
	runtime.retryTimer = setTimeout(() => {
		runtime.retryTimer = undefined;
		void connectRuntime(runtime);
	}, milliseconds);
}

async function handleDisconnect(
	runtime: AccountRuntime,
	client: MaxProtocolClient,
	error: Error,
): Promise<void> {
	if (runtime.stopped || runtime.client !== client) return;
	runtime.client = null;
	console.error(
		`[max-userbot-worker] соединение потеряно ${accountLabel(runtime.account)}: ${error.message}`,
	);
	await runtime.outboxLoop?.catch(() => {});
	if (!runtime.stopped) scheduleReconnect(runtime);
}

async function connectRuntime(runtime: AccountRuntime): Promise<void> {
	if (runtime.stopped || runtime.connecting || runtime.client) return;
	runtime.connecting = true;
	let client: MaxProtocolClient | undefined;
	let ready = false;
	try {
		client = await createUserbotClient(
			decryptSecret(runtime.account.sessionEncrypted),
			{
				onMessage: (message) => {
					if (!message.chatId || message.senderId === null || !message.text)
						return;
					void logInboundMessage(
						runtime.account,
						message.chatId,
						message.text,
						message.messageId,
					);
					void relayInboundMessage(runtime.account, message);
				},
				onDisconnect: (error) => {
					if (ready && client) void handleDisconnect(runtime, client, error);
				},
			},
		);
		if (runtime.stopped) {
			client.close();
			return;
		}
		ready = true;
		runtime.client = client;
		runtime.retryAttempt = 0;
		await recoverMaxOutboundMessages(
			runtime.account.memberId,
			runtime.account.openLineId,
			runtime.account.connectorId,
		);
		runtime.outboxLoop = runOutbox(runtime, client).catch((error) => {
			console.error(
				`[max-userbot-worker] очередь остановлена ${accountLabel(runtime.account)}: ${(error as Error).message}`,
			);
			if (!runtime.stopped && runtime.client === client) {
				runtime.client = null;
				client.close();
				scheduleReconnect(runtime);
			}
		});
		console.log(
			`[max-userbot-worker] запущен: ${accountLabel(runtime.account)}`,
		);
	} catch (error) {
		const failure = error as Error;
		client?.close();
		console.error(
			`[max-userbot-worker] ошибка запуска ${accountLabel(runtime.account)}: ${failure.message}`,
		);
		if (isPermanentAuthError(failure)) {
			runtime.stopped = true;
			await markMaxPersonalAccountError(
				runtime.account.memberId,
				runtime.account.openLineId,
				runtime.account.connectorId,
				failure.message,
			);
			if (runtimes.get(runtime.key) === runtime) runtimes.delete(runtime.key);
		} else {
			scheduleReconnect(runtime);
		}
	} finally {
		runtime.connecting = false;
	}
}

async function stopRuntime(runtime: AccountRuntime): Promise<void> {
	runtime.stopped = true;
	if (runtime.retryTimer) clearTimeout(runtime.retryTimer);
	runtime.retryTimer = undefined;
	const client = runtime.client;
	runtime.client = null;
	client?.close();
	await runtime.outboxLoop?.catch(() => {});
	console.log(
		`[max-userbot-worker] остановлен: ${accountLabel(runtime.account)}`,
	);
}

async function main(): Promise<void> {
	let scanning = false;
	const scan = async () => {
		if (scanning) return;
		scanning = true;
		try {
			const accounts = await listConnectedMaxPersonalAccounts();
			const desired = new Map(
				accounts.map((account) => [accountKey(account), account]),
			);

			for (const [key, runtime] of runtimes) {
				const account = desired.get(key);
				if (!account) {
					await stopRuntime(runtime);
					runtimes.delete(key);
				} else {
					runtime.account = account;
				}
			}

			for (const [key, account] of desired) {
				if (runtimes.has(key)) continue;
				const runtime: AccountRuntime = {
					key,
					account,
					client: null,
					connecting: false,
					stopped: false,
					retryAttempt: 0,
				};
				runtimes.set(key, runtime);
				void connectRuntime(runtime);
			}
		} finally {
			scanning = false;
		}
	};

	await scan();
	setInterval(() => void scan(), ACCOUNTS_RESCAN_INTERVAL_MS);
}

await main();
