import {
	getBotConnector,
	getDeletableBotMessage,
	listMaxPersonalAccounts,
	listTelegramPersonalAccounts,
	listWhatsappPersonalAccounts,
	markBotMessageDeleted,
} from "@psi-opora/db/queries";
import { deleteMessengerMessage, formatMessengerError } from "@psi-opora/jobs";
import { getSendResult, pushOutboundMessage } from "@psi-opora/tg-userbot";
import {
	getMaxSendResult,
	pushMaxOutboundMessage,
} from "@psi-opora/max-userbot";
import { wahaDeleteMessage } from "@psi-opora/waha";
import { bitrixProcedure } from "../../orpc";
import { deleteClientMessageSchema } from "../../schemas/messages";
import { type ClientMessageItem, toClientMessageItem } from "./types";

const TELEGRAM_DELETE_WINDOW_MS = 48 * 60 * 60 * 1000;
const USERBOT_RESULT_POLL_INTERVAL_MS = 300;
const USERBOT_RESULT_TIMEOUT_MS = 6000;

interface OpenLineRef {
	connectorId: string;
	openLineId: string;
}

async function deleteTelegramPersonal(params: {
	memberId: string;
	connector: OpenLineRef;
	userId: string;
	externalId: string;
}): Promise<void> {
	const telegramUserId = Number(params.userId);
	if (!Number.isSafeInteger(telegramUserId)) {
		throw new Error(
			"Для этого старого сообщения не сохранён Telegram ID клиента",
		);
	}
	const jobId = crypto.randomUUID();
	await pushOutboundMessage({
		memberId: params.memberId,
		openLineId: params.connector.openLineId,
		connectorId: params.connector.connectorId,
		jobId,
		action: "delete",
		telegramUserId,
		externalId: params.externalId,
	});

	const deadline = Date.now() + USERBOT_RESULT_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const result = await getSendResult(jobId);
		if (result) {
			if (result.ok) return;
			throw new Error(result.error ?? "Личный Telegram не удалил сообщение");
		}
		await new Promise((resolve) =>
			setTimeout(resolve, USERBOT_RESULT_POLL_INTERVAL_MS),
		);
	}
	throw new Error("Не удалось дождаться удаления от worker личного Telegram");
}

async function deleteMaxPersonal(params: {
	memberId: string;
	connector: OpenLineRef;
	chatId: string;
	externalId: string;
}): Promise<void> {
	const chatId = params.chatId.trim();
	if (!/^\d+$/.test(chatId)) throw new Error("Некорректный chatId MAX");
	const jobId = crypto.randomUUID();
	await pushMaxOutboundMessage({
		memberId: params.memberId,
		openLineId: params.connector.openLineId,
		connectorId: params.connector.connectorId,
		jobId,
		action: "delete",
		chatId,
		externalId: params.externalId,
	});
	const deadline = Date.now() + USERBOT_RESULT_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const result = await getMaxSendResult(jobId);
		if (result) {
			if (result.ok) return;
			throw new Error(result.error ?? "Личный MAX не удалил сообщение");
		}
		await new Promise((resolve) =>
			setTimeout(resolve, USERBOT_RESULT_POLL_INTERVAL_MS),
		);
	}
	throw new Error("Не удалось дождаться удаления от max-userbot-worker");
}

export const deleteMessage = bitrixProcedure
	.input(deleteClientMessageSchema)
	.handler(
		async ({
			input,
			context,
		}): Promise<{
			message?: ClientMessageItem;
			warning?: string;
			error?: string;
		}> => {
			const operatorId = context.bitrixSession.userId;
			const row = await getDeletableBotMessage(input.messageId, operatorId);
			if (!row?.externalId) {
				return {
					error:
						"Сообщение нельзя удалить: оно отправлено другим оператором, уже удалено или не содержит внешний ID",
				};
			}
			if (
				row.messenger === "telegram" &&
				Date.now() - row.createdAt.getTime() >= TELEGRAM_DELETE_WINDOW_MS
			) {
				return {
					error: "Telegram позволяет ботам удалять сообщения только 48 часов",
				};
			}

			let connector: OpenLineRef | undefined;
			let whatsappSession: string | undefined;
			if (row.messenger === "telegram" || row.messenger === "max") {
				const botConnector = await getBotConnector(row.messenger);
				if (botConnector) {
					connector = {
						connectorId: botConnector.connectorId,
						openLineId: botConnector.openLineId,
					};
				}
			} else {
				if (!context.memberId || !row.connectorId) {
					return {
						error:
							"Не удалось определить личный номер, с которого отправлено сообщение",
					};
				}
				if (row.messenger === "telegram-personal") {
					const account = (
						await listTelegramPersonalAccounts(context.memberId)
					).find((item) => item.connectorId === row.connectorId);
					if (account) {
						connector = {
							connectorId: account.connectorId,
							openLineId: account.openLineId,
						};
					}
				} else if (row.messenger === "whatsapp-personal") {
					const account = (
						await listWhatsappPersonalAccounts(context.memberId)
					).find((item) => item.connectorId === row.connectorId);
					if (account) {
						connector = {
							connectorId: account.connectorId,
							openLineId: account.openLineId,
						};
						whatsappSession = account.sessionName;
					}
				} else if (row.messenger === "max-personal") {
					const account = (
						await listMaxPersonalAccounts(context.memberId)
					).find((item) => item.connectorId === row.connectorId);
					if (account) {
						connector = {
							connectorId: account.connectorId,
							openLineId: account.openLineId,
						};
					}
				}
				if (!connector) {
					return { error: "Личный номер сообщения больше не подключён" };
				}
			}

			try {
				if (row.messenger === "telegram" || row.messenger === "max") {
					await deleteMessengerMessage(
						row.messenger,
						row.userId,
						row.externalId,
					);
				} else if (row.messenger === "telegram-personal") {
					if (!context.memberId || !connector) {
						throw new Error("Личный номер Telegram не найден");
					}
					await deleteTelegramPersonal({
						memberId: context.memberId,
						connector,
						userId: row.externalChatId ?? row.userId,
						externalId: row.externalId,
					});
				} else if (row.messenger === "whatsapp-personal") {
					if (!whatsappSession) {
						throw new Error("Сессия личного WhatsApp не найдена");
					}
					await wahaDeleteMessage(whatsappSession, row.userId, row.externalId);
				} else if (row.messenger === "max-personal") {
					if (!context.memberId || !connector) {
						throw new Error("Личный номер MAX не найден");
					}
					await deleteMaxPersonal({
						memberId: context.memberId,
						connector,
						chatId: row.externalChatId ?? row.userId,
						externalId: row.externalId,
					});
				} else {
					return { error: `Удаление для ${row.messenger} не поддерживается` };
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(
					`[messages] не удалось удалить ${row.messenger} message=${row.externalId}: ${message}`,
				);
				return { error: `Не удалено: ${formatMessengerError(message)}` };
			}

			let warning: string | undefined;
			const api = await context.getBitrixApi();
			if (api) {
				try {
					if (row.bitrixMessageId) {
						await api.call("im.message.delete", {
							MESSAGE_ID: row.bitrixMessageId,
						});
					} else if (row.bitrixExternalId && connector) {
						await api.call("imconnector.delete.messages", {
							CONNECTOR: connector.connectorId,
							LINE: Number(connector.openLineId),
							MESSAGES: [
								{
									user: { id: row.userId },
									message: { id: row.bitrixExternalId },
									chat: { id: row.userId },
								},
							],
						});
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					console.error(
						`[messages] сообщение удалено у клиента, но не в Bitrix: ${message}`,
					);
					warning =
						"У клиента сообщение удалено, но Битрикс24 не разрешил удалить копию";
				}
			}

			const updated = await markBotMessageDeleted(row.id, operatorId);
			if (!updated) {
				return {
					error:
						"Сообщение удалено у клиента, но локальная история не обновилась — перезагрузите диалог",
				};
			}
			return {
				message: toClientMessageItem(updated, operatorId),
				warning,
			};
		},
	);
