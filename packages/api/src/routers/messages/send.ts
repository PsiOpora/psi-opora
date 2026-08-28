import { type BitrixApi, resolveBitrixApi } from "@psi-opora/bitrix-client";
import {
	createRedisClient,
	isRedisConfigured,
	mirrorOperatorMessageToOpenLine,
	type RedisClient,
} from "@psi-opora/bot-core";
import {
	getBitrixCrmLink,
	getBotConnector,
	insertBotMessage,
	listMaxPersonalAccounts,
	listTelegramPersonalAccounts,
	listWhatsappPersonalAccounts,
	setBotMessageBitrixExternalId,
	setWhatsappPersonalAccountStateBySession,
	upsertBitrixCrmLink,
} from "@psi-opora/db/queries";
import {
	formatMessengerError,
	sendMessengerMediaMessage,
	sendMessengerMessage,
} from "@psi-opora/jobs";
import {
	getMaxSendResult,
	pushMaxOutboundMessage,
} from "@psi-opora/max-userbot";
import {
	wahaGetSession,
	wahaSendFile,
	wahaSendText,
	wahaSessionHealth,
} from "@psi-opora/waha";
import { downloadOutboundAttachment } from "../../message-attachment-storage";
import { bitrixProcedure } from "../../orpc";
import { sendClientMessageSchema } from "../../schemas/messages";
import {
	captureWhatsappPresence,
	sendViaPersonalNumber,
} from "../widget-message/helpers";
import { resolveTelegramPersonalTarget } from "./telegram-personal-target";

const operatorMirrorRedis: RedisClient | undefined = isRedisConfigured()
	? createRedisClient()
	: undefined;

interface OpenLineConnectorRef {
	connectorId: string;
	openLineId: string;
}

async function sendMaxPersonal(
	memberId: string | null,
	userId: string,
	lineId: string | undefined,
	connectorId: string | undefined,
	text: string,
): Promise<{
	ok?: true;
	error?: string;
	externalId?: string;
	connector?: OpenLineConnectorRef;
}> {
	if (!memberId) return { error: "Нет активной сессии Битрикс24" };
	const chatId = userId.trim();
	if (!/^\d+$/.test(chatId)) {
		return { error: "Для диалога MAX не сохранён числовой chatId" };
	}
	const accounts = (await listMaxPersonalAccounts(memberId)).filter(
		(account) => account.status === "connected",
	);
	const matches = connectorId
		? accounts.filter((account) => account.connectorId === connectorId)
		: lineId
			? accounts.filter((account) => account.openLineId === lineId)
			: accounts;
	if (matches.length > 1) {
		return {
			error: "Подключено несколько личных номеров MAX — выберите номер",
		};
	}
	const account = matches[0];
	if (!account) return { error: "Личный номер MAX не подключён" };

	const jobId = crypto.randomUUID();
	await pushMaxOutboundMessage({
		memberId,
		openLineId: account.openLineId,
		connectorId: account.connectorId,
		jobId,
		chatId,
		text,
	});
	const deadline = Date.now() + 6000;
	while (Date.now() < deadline) {
		const result = await getMaxSendResult(jobId);
		if (result) {
			return result.ok
				? {
						ok: true,
						externalId: result.externalId,
						connector: {
							connectorId: account.connectorId,
							openLineId: account.openLineId,
						},
					}
				: { error: `Не отправлено: ${result.error ?? "неизвестная ошибка"}` };
		}
		await new Promise((resolve) => setTimeout(resolve, 300));
	}
	return { error: "Не удалось дождаться ответа max-userbot-worker" };
}

/**
 * Отправляет через личный номер Telegram — userId диалога здесь тот же
 * численный chat/sender id, что и в bot_messages для этого канала (см.
 * apps/tg-userbot-worker logInboundMessage и apps/bitrix-webhook
 * logOperatorReply, где userId = String(chatId)), а не телефон — поэтому
 * адресуем как kind: "id", в отличие от вкладки CRM (widget-message/send.ts),
 * где телефон известен из карточки контакта и это kind: "phone".
 */
async function sendTelegramPersonal(
	api: BitrixApi | null,
	memberId: string | null,
	userId: string,
	lineId: string | undefined,
	connectorId: string | undefined,
	text: string,
	attachment:
		| {
				s3Key: string;
				fileName: string;
				mimeType: string;
				kind: "image" | "file" | "voice";
		  }
		| undefined,
): Promise<{
	ok?: true;
	error?: string;
	connector?: OpenLineConnectorRef;
	telegramUserId?: string;
	externalId?: string;
}> {
	if (!memberId) {
		return { error: "Нет активной сессии Битрикс24 — обновите страницу" };
	}
	const accounts = (await listTelegramPersonalAccounts(memberId)).filter(
		(a) => a.status === "connected",
	);

	let account: (typeof accounts)[number] | undefined;
	if (connectorId) {
		account = accounts.find((a) => a.connectorId === connectorId);
	} else {
		const matches = lineId
			? accounts.filter((a) => a.openLineId === lineId)
			: accounts;
		if (matches.length > 1) {
			return {
				error: lineId
					? "На этой линии несколько личных номеров Telegram — уточните, с какого отправить"
					: "На портале несколько личных номеров Telegram — отправка из единого инбокса пока поддерживает один",
			};
		}
		account = matches[0];
	}
	if (!account) return { error: "Личный номер Telegram не подключён" };

	const target = await resolveTelegramPersonalTarget(api, userId);
	const result = await sendViaPersonalNumber({
		memberId,
		openLineId: account.openLineId,
		connectorId: account.connectorId,
		target,
		text,
		attachment,
	});
	if (result.error) return result;
	return {
		ok: true,
		connector: {
			connectorId: account.connectorId,
			openLineId: account.openLineId,
		},
		telegramUserId: result.telegramUserId,
		externalId: result.externalId,
	};
}

/**
 * Отправляет через личный номер WhatsApp — userId диалога это jid
 * (`"79991234567@c.us"`, см. packages/waha phoneFromJid/jidFromPhone),
 * WAHA отправляет по нему напрямую, без отдельного шага резолва пира.
 */
async function sendWhatsappPersonal(
	memberId: string | null,
	userId: string,
	lineId: string | undefined,
	connectorId: string | undefined,
	text: string,
	attachment:
		| {
				s3Key: string;
				fileName: string;
				mimeType: string;
				kind: "image" | "file" | "voice";
		  }
		| undefined,
): Promise<{
	ok?: true;
	error?: string;
	externalId?: string;
	connector?: OpenLineConnectorRef;
}> {
	if (!memberId) {
		return { error: "Нет активной сессии Битрикс24 — обновите страницу" };
	}
	const accounts = (await listWhatsappPersonalAccounts(memberId)).filter(
		(a) => a.status === "connected",
	);

	let account: (typeof accounts)[number] | undefined;
	if (connectorId) {
		account = accounts.find((a) => a.connectorId === connectorId);
	} else {
		const matches = lineId
			? accounts.filter((a) => a.openLineId === lineId)
			: accounts;
		if (matches.length > 1) {
			return {
				error: lineId
					? "На этой линии несколько личных номеров WhatsApp — уточните, с какого отправить"
					: "На портале несколько личных номеров WhatsApp — отправка из единого инбокса пока поддерживает один",
			};
		}
		account = matches[0];
	}
	if (!account) return { error: "Личный номер WhatsApp не подключён" };

	try {
		const { id } = attachment
			? await wahaSendFile(
					account.sessionName,
					userId,
					{
						bytes: await downloadOutboundAttachment(attachment.s3Key),
						fileName: attachment.fileName,
						mimeType: attachment.mimeType,
						kind: attachment.kind,
					},
					text || undefined,
				)
			: await wahaSendText(account.sessionName, userId, text);
		await captureWhatsappPresence(account.sessionName, userId).catch((err) =>
			console.error(
				`[messages] не удалось получить WhatsApp presence ${userId}: ${(err as Error).message}`,
			),
		);
		return {
			ok: true,
			externalId: id,
			connector: {
				connectorId: account.connectorId,
				openLineId: account.openLineId,
			},
		};
	} catch (err) {
		const health = wahaSessionHealth(
			await wahaGetSession(account.sessionName).catch(() => null),
		);
		if (health.status !== "connected") {
			await setWhatsappPersonalAccountStateBySession(
				account.sessionName,
				health.status,
				health.error,
			).catch(() => {});
		}
		return { error: `Не отправлено: ${(err as Error).message}` };
	}
}

/**
 * Отправляет сообщение клиенту из единого инбокса («Клиенты»). В отличие от
 * вкладки CRM (widget-message/send.ts) канал уже надёжно известен — это тот
 * же messenger/userId, что и у выбранной строки списка (bot_users), поход в
 * CRM за резолвингом контакта не нужен. Комментарий в таймлайн CRM не пишем —
 * здесь нет известного contactId, а история и так видна в инбоксе. Но в саму
 * Открытую линию ответ дублируем (см. mirrorOperatorMessageToOpenLine ниже),
 * чтобы оператор, работающий из Открытой линии, видел и эти реплики тоже.
 */
export const send = bitrixProcedure
	.input(sendClientMessageSchema)
	.handler(
		async ({ input, context }): Promise<{ ok?: true; error?: string }> => {
			const text = input.text.trim();
			if (!text && !input.attachment) {
				return { error: "Введите текст сообщения или прикрепите файл" };
			}
			// Авторство берём из подписанной Bitrix-сессии, а не из клиентского
			// payload: профиль оператора в React может ещё не успеть загрузиться.
			const operatorId = context.bitrixSession.userId;

			// Личный номер MAX работает через собственный бинарный протокол
			// (packages/max-userbot), в котором опкоды загрузки вложений
			// (FILE_UPLOAD/PHOTO_UPLOAD) существуют по данным реверс-инжиниринга,
			// но никогда не реализовывались и не проверялись вживую — в отличие
			// от MSG_SEND. Слепая реализация протокольной загрузки бинарников без
			// возможности проверить её на реальном сервере рискует непредсказуемо
			// сломать соединение воркера, поэтому вложения через этот канал пока
			// не поддерживаются явной ошибкой, а не тихой попыткой угадать протокол.
			if (input.messenger === "max-personal" && input.attachment) {
				return {
					error:
						"Отправка файлов/изображений через личный номер MAX пока не поддерживается",
				};
			}

			let externalId: string | undefined;
			let connector: OpenLineConnectorRef | undefined;
			let canonicalTelegramUserId: string | undefined;

			if (input.messenger === "telegram-personal") {
				const api = await context.getBitrixApi();
				const result = await sendTelegramPersonal(
					api,
					context.memberId,
					input.userId,
					input.lineId,
					input.connectorId,
					text,
					input.attachment,
				);
				if (result.error) return result;
				connector = result.connector;
				canonicalTelegramUserId = result.telegramUserId;
				externalId = result.externalId;

				// Если старый диалог был заведён по телефону, после успешного
				// резолва сохраняем канонический Telegram ID как второй ключ того же
				// контакта. Следующее входящее сообщение придёт уже по этому ID.
				if (
					canonicalTelegramUserId &&
					canonicalTelegramUserId !== input.userId
				) {
					try {
						const link = await getBitrixCrmLink(
							"telegram-personal",
							input.userId,
						);
						if (link?.contactId) {
							await upsertBitrixCrmLink({
								messenger: "telegram-personal",
								userId: canonicalTelegramUserId,
								contactId: link.contactId,
							});
						}
					} catch (err) {
						console.error(
							`[messages] не удалось сохранить канонический Telegram ID: ${(err as Error).message}`,
						);
					}
				}
			} else if (input.messenger === "whatsapp-personal") {
				const result = await sendWhatsappPersonal(
					context.memberId,
					input.userId,
					input.lineId,
					input.connectorId,
					text,
					input.attachment,
				);
				if (result.error) return result;
				externalId = result.externalId;
				connector = result.connector;
			} else if (input.messenger === "max-personal") {
				const result = await sendMaxPersonal(
					context.memberId,
					input.userId,
					input.lineId,
					input.connectorId,
					text,
				);
				if (result.error) return result;
				externalId = result.externalId;
				connector = result.connector;
			} else {
				try {
					externalId = input.attachment
						? await sendMessengerMediaMessage(
								input.messenger,
								input.userId,
								{
									bytes: await downloadOutboundAttachment(
										input.attachment.s3Key,
									),
									fileName: input.attachment.fileName,
									mimeType: input.attachment.mimeType,
									kind: input.attachment.kind,
								},
								text || undefined,
							)
						: await sendMessengerMessage(input.messenger, input.userId, text);
				} catch (err) {
					const error = err as Error;
					console.error(
						`[messages] ошибка отправки ${input.messenger}: ${error.message}`,
						error.cause ?? "",
					);
					return {
						error: `Не отправлено: ${formatMessengerError(error.message)}`,
					};
				}
				const botConnector = await getBotConnector(input.messenger).catch(
					() => null,
				);
				if (botConnector) {
					connector = {
						connectorId: botConnector.connectorId,
						openLineId: botConnector.openLineId,
					};
				}
			}

			let storedMessageId: string | undefined;
			try {
				storedMessageId = await insertBotMessage({
					messenger: input.messenger,
					userId: input.userId,
					direction: "out",
					source: "widget",
					text:
						text ||
						(input.attachment?.kind === "image"
							? "Фото"
							: input.attachment?.kind === "voice"
								? "Голосовое сообщение"
								: "Файл"),
					operatorId,
					operatorName: input.operatorName,
					externalId,
					externalChatId:
						input.messenger === "max-personal"
							? input.userId
							: canonicalTelegramUserId,
					connectorId: connector?.connectorId,
					...(input.attachment
						? {
								kind: input.attachment.kind,
								mediaS3Key: input.attachment.s3Key,
								mediaMimeType: input.attachment.mimeType,
								mediaFileName: input.attachment.fileName,
							}
						: {}),
				});
			} catch (err) {
				console.error(
					`[messages] не удалось записать сообщение в журнал: ${(err as Error).message}`,
				);
			}

			// Если диалог/коннектор известен, отражаем сообщение в Открытой линии.
			// operatorId надёжно получен из подписанной Bitrix-сессии выше.
			if (connector) {
				const api = resolveBitrixApi(context.memberId ?? undefined);
				const bitrixExternalId = await mirrorOperatorMessageToOpenLine(
					api ?? undefined,
					connector,
					{
						messenger: input.messenger,
						userId: canonicalTelegramUserId ?? input.userId,
						text,
						operatorId,
					},
					operatorMirrorRedis,
				);
				if (storedMessageId && bitrixExternalId) {
					await setBotMessageBitrixExternalId(
						storedMessageId,
						bitrixExternalId,
					).catch((err) =>
						console.error(
							`[messages] не удалось сохранить ID зеркала Bitrix: ${(err as Error).message}`,
						),
					);
				}
			}

			return { ok: true };
		},
	);
