import {
	type BitrixApi,
	resolveBitrixPortalKey,
} from "@psi-opora/bitrix-client";
import { insertBotMessage } from "@psi-opora/db/queries";
import {
	formatMessengerError,
	isBotBlockedError,
	sendMessengerMediaMessage,
	sendMessengerMessage,
} from "@psi-opora/jobs";
import { downloadOutboundAttachment } from "../../message-attachment-storage";
import { bitrixProcedure } from "../../orpc";
import {
	MESSAGE_MAX_LENGTH,
	type SendWidgetMessageInput,
	sendWidgetMessageSchema,
} from "../../schemas/broadcast";
import { persistWidgetCrmLinks } from "./crm-linking";
import {
	resolveContact,
	sendViaMaxPersonal,
	sendViaPersonalNumber,
	sendViaWhatsappPersonal,
} from "./helpers";

/** Каналы, где один и тот же messenger может быть подключён несколькими
 * личными номерами — канал однозначно определяется только парой
 * (messenger, lineId). */
function needsLineMatch(messenger: string): boolean {
	return (
		messenger === "telegram-personal" ||
		messenger === "whatsapp-personal" ||
		messenger === "max-personal"
	);
}

/** Подпись к сообщению без текста — в журнале и таймлайне CRM. */
function attachmentCaption(
	attachment: SendWidgetMessageInput["attachment"],
): string {
	if (attachment?.kind === "image") return "Фото";
	if (attachment?.kind === "voice") return "Голосовое сообщение";
	return attachment ? `Файл: ${attachment.fileName}` : "";
}

/** Что нужно отправке от запроса: из живой сессии (процедура send) или
 * восстановленное воркером отложенных сообщений. */
export interface SendWidgetMessageContext {
	memberId: string | null;
	/** Bitrix-ID автора — из подписанной сессии; у отложенных его нет. */
	operatorId?: string;
	getBitrixApi: () => Promise<BitrixApi | null>;
}

/**
 * Отправляет сообщение клиенту от имени бота выбранного мессенджера (или
 * с личного номера Telegram) и фиксирует его комментарием в таймлайне контакта.
 *
 * userId/lineId получателя намеренно не принимаются от клиента напрямую для
 * отправки — канал ищется среди пересчитанных здесь же из актуальных данных
 * CRM (resolveContact), иначе вызывающий мог бы подставить произвольные
 * значения и отправить сообщение кому угодно, минуя привязку к контакту.
 *
 * Вынесено из процедуры, чтобы то же самое делал воркер отложенных сообщений.
 */
export async function sendWidgetMessage(
	input: SendWidgetMessageInput,
	context: SendWidgetMessageContext,
): Promise<{ ok?: true; error?: string }> {
	const text = input.text.trim();
	const attachment = input.attachment;
	if (!text && !attachment) {
		return { error: "Введите текст сообщения или прикрепите файл" };
	}
	if (text.length > MESSAGE_MAX_LENGTH) {
		return { error: `Сообщение длиннее ${MESSAGE_MAX_LENGTH} символов` };
	}

	const api = await context.getBitrixApi();
	if (!api) {
		return { error: "Нет подключения к Битрикс24 — обновите страницу" };
	}

	const { contact, error } = await resolveContact(
		api,
		input.entity,
		input.entityId,
		context.memberId,
	).catch((err) => ({
		error: (err as Error).message,
		contact: undefined,
	}));
	if (error || !contact) {
		return { error: error ?? "Не удалось определить контакт" };
	}

	const channel = contact.channels.find(
		(c) =>
			c.messenger === input.messenger &&
			(!needsLineMatch(input.messenger) ||
				(input.connectorId
					? c.connectorId === input.connectorId
					: c.lineId === input.lineId)),
	);
	if (!channel) {
		return { error: "У контакта нет такого канала — обновите страницу" };
	}

	// Личный MAX общается по реверс-инжиниринговому протоколу, где загрузка
	// файлов не реализована (см. messages/send.ts) — честная ошибка, а не попытка угадать.
	if (attachment && channel.messenger === "max-personal") {
		return {
			error:
				"Отправка файлов/изображений через личный номер MAX пока не поддерживается",
		};
	}

	let externalId: string | undefined;
	let canonicalTelegramUserId: string | undefined;
	let canonicalMaxChatId: string | undefined;

	if (channel.messenger === "telegram-personal") {
		if (!context.memberId || !channel.lineId || !channel.connectorId) {
			return { error: "Нет активной сессии Битрикс24 — обновите страницу" };
		}
		const result = await sendViaPersonalNumber({
			memberId: context.memberId,
			openLineId: channel.lineId,
			connectorId: channel.connectorId,
			target: {
				kind: channel.personalTargetKind ?? "phone",
				value: channel.userId,
			},
			text,
			attachment,
		});
		if (result.error) return result;
		canonicalTelegramUserId = result.telegramUserId;
		externalId = result.externalId;
	} else if (channel.messenger === "whatsapp-personal") {
		if (!context.memberId || !channel.lineId || !channel.connectorId) {
			return { error: "Нет активной сессии Битрикс24 — обновите страницу" };
		}
		const result = await sendViaWhatsappPersonal({
			memberId: context.memberId,
			openLineId: channel.lineId,
			connectorId: channel.connectorId,
			jid: channel.userId,
			text,
			attachment,
		});
		if (result.error) return result;
		externalId = result.externalId;
	} else if (channel.messenger === "max-personal") {
		if (!context.memberId || !channel.lineId || !channel.connectorId) {
			return { error: "Нет активной сессии Битрикс24 — обновите страницу" };
		}
		const result = await sendViaMaxPersonal({
			memberId: context.memberId,
			openLineId: channel.lineId,
			connectorId: channel.connectorId,
			phone: channel.userId,
			text,
		});
		if (result.error) return { error: result.error };
		canonicalMaxChatId = result.chatId;
		externalId = result.externalId;
	} else {
		try {
			externalId = attachment
				? await sendMessengerMediaMessage(
						channel.messenger,
						channel.userId,
						{
							bytes: await downloadOutboundAttachment(attachment.s3Key),
							fileName: attachment.fileName,
							mimeType: attachment.mimeType,
							kind: attachment.kind,
						},
						text || undefined,
					)
				: await sendMessengerMessage(channel.messenger, channel.userId, text);
		} catch (err) {
			const error = err as Error;
			// Клиент остановил/заблокировал бота — не сбой, в SigNoz не шлём.
			(isBotBlockedError(error.message) ? console.warn : console.error)(
				`[widget] ошибка отправки ${channel.messenger}: ${error.message}`,
				error.cause ?? "",
				error.stack ?? "",
			);
			return {
				error: `Не отправлено: ${formatMessengerError(error.message)}`,
			};
		}
	}

	// CRM-виджет уже знает точный contactId, поэтому сохраняем связь сразу,
	// не ожидая входящего сообщения и CRM-трекера Открытой линии.
	// Для первого исходящего Telegram Personal userId часто является
	// телефоном/username. Воркер возвращает канонический Telegram ID —
	// сохраняем и его как второй ключ, чтобы будущий входящий диалог
	// автоматически открыл тот же контакт.
	try {
		await persistWidgetCrmLinks({
			portalKey: await resolveBitrixPortalKey(context.memberId),
			messenger: channel.messenger,
			userId: channel.userId,
			contactId: contact.contactId,
			canonicalTelegramUserId,
			canonicalMaxChatId,
		});
	} catch (err) {
		console.error(
			`[widget] не удалось сохранить CRM-связь: ${(err as Error).message}`,
		);
	}

	// Журнал сообщений — история видна во вкладке при следующем открытии
	try {
		await insertBotMessage({
			messenger: channel.messenger,
			// Диалог MAX в журнале живёт под chatId (под ним же пишет входящие
			// воркер), а не под телефоном, по которому отправили.
			userId: canonicalMaxChatId ?? channel.userId,
			direction: "out",
			source: "widget",
			text: text || attachmentCaption(attachment),
			operatorId: context.operatorId,
			operatorName: input.operatorName,
			externalId,
			externalChatId: canonicalMaxChatId ?? canonicalTelegramUserId,
			connectorId: channel.connectorId,
			...(attachment
				? {
						kind: attachment.kind,
						mediaS3Key: attachment.s3Key,
						mediaMimeType: attachment.mimeType,
						mediaFileName: attachment.fileName,
					}
				: {}),
		});
	} catch (err) {
		const error = err as Error;
		console.error(
			`[widget] не удалось записать сообщение в журнал: ${error.message}`,
			error.cause ?? "",
			error.stack ?? "",
		);
	}

	// История переписки должна быть видна менеджеру — пишем в таймлайн.
	// Ошибка комментария не отменяет отправку, просто логируется.
	try {
		await api.call("crm.timeline.comment.add", {
			fields: {
				ENTITY_ID: Number(contact.contactId),
				ENTITY_TYPE: "contact",
				COMMENT: `🤖 Отправлено ботом (${channel.label}):\n${text || attachmentCaption(attachment)}`,
			},
		});
	} catch (err) {
		console.error(
			`[widget] не удалось добавить комментарий в таймлайн: ${(err as Error).message}`,
		);
	}

	return { ok: true };
}

export const send = bitrixProcedure.input(sendWidgetMessageSchema).handler(
	async ({ input, context }): Promise<{ ok?: true; error?: string }> =>
		sendWidgetMessage(input, {
			memberId: context.memberId,
			operatorId: context.bitrixSession.userId,
			getBitrixApi: () => context.getBitrixApi(),
		}),
);
