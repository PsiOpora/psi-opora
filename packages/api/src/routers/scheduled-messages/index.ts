import {
	cancelScheduledMessage,
	getScheduledMessage,
	insertScheduledMessage,
	listScheduledMessagesForDialog,
	listScheduledMessagesForEntity,
	type ScheduledMessage,
} from "@psi-opora/db/queries";
import { bitrixProcedure, router } from "../../orpc";
import { MESSAGE_MAX_LENGTH } from "../../schemas/broadcast";
import {
	cancelScheduledMessageSchema,
	listScheduledClientMessagesSchema,
	listScheduledWidgetMessagesSchema,
	SCHEDULE_MAX_AHEAD_DAYS,
	SCHEDULE_MIN_AHEAD_SECONDS,
	scheduleClientMessageSchema,
	scheduleWidgetMessageSchema,
} from "../../schemas/scheduled-messages";
import type { ScheduledMessageItem, ScheduleMessageResult } from "./types";

function toItem(row: ScheduledMessage): ScheduledMessageItem {
	return {
		id: row.id,
		messenger: row.messenger,
		text: row.text,
		sendAt: row.sendAt.toISOString(),
		// Выборка отдаёт только эти три статуса (см. visibleToOperator в db).
		status: row.status as ScheduledMessageItem["status"],
		error: row.error,
		operatorName: row.operatorName,
		attachment: row.attachment
			? { fileName: row.attachment.fileName, kind: row.attachment.kind }
			: null,
	};
}

/** Разбирает время отправки и проверяет, что оно в допустимом окне. */
function parseSendAt(iso: string): { sendAt: Date } | { error: string } {
	const sendAt = new Date(iso);
	const now = Date.now();
	if (Number.isNaN(sendAt.getTime())) {
		return { error: "Некорректные дата и время отправки" };
	}
	if (sendAt.getTime() < now + SCHEDULE_MIN_AHEAD_SECONDS * 1000) {
		return { error: "Выберите время в будущем" };
	}
	if (sendAt.getTime() > now + SCHEDULE_MAX_AHEAD_DAYS * 24 * 3600 * 1000) {
		return {
			error: `Нельзя отложить дальше чем на ${SCHEDULE_MAX_AHEAD_DAYS} дней`,
		};
	}
	return { sendAt };
}

/** Откладывает сообщение из инбокса «Клиенты»: диалог (messenger/userId) уже известен. */
const scheduleClient = bitrixProcedure
	.input(scheduleClientMessageSchema)
	.handler(async ({ input, context }): Promise<ScheduleMessageResult> => {
		const parsed = parseSendAt(input.sendAt);
		if ("error" in parsed) return { ok: false, error: parsed.error };

		// То же ограничение, что и при немедленной отправке (messages/send.ts).
		if (input.messenger === "max-personal" && input.attachment) {
			return {
				ok: false,
				error:
					"Отправка файлов/изображений через личный номер MAX пока не поддерживается",
			};
		}

		const row = await insertScheduledMessage({
			memberId: context.memberId,
			kind: "inbox",
			messenger: input.messenger,
			userId: input.userId,
			lineId: input.lineId,
			connectorId: input.connectorId,
			text: input.text.trim(),
			attachment: input.attachment,
			// Авторство — из подписанной Bitrix-сессии, как и при обычной отправке.
			operatorId: context.bitrixSession.userId,
			operatorName: input.operatorName,
			sendAt: parsed.sendAt,
		});
		if (!row) return { ok: false, error: "Не удалось сохранить сообщение" };
		return { ok: true, item: toItem(row) };
	});

/** Откладывает сообщение из вкладки «Мессенджер» в карточке сделки/контакта. */
const scheduleWidget = bitrixProcedure
	.input(scheduleWidgetMessageSchema)
	.handler(async ({ input, context }): Promise<ScheduleMessageResult> => {
		const text = input.text.trim();
		if (!text) return { ok: false, error: "Введите текст сообщения" };
		if (text.length > MESSAGE_MAX_LENGTH) {
			return {
				ok: false,
				error: `Сообщение длиннее ${MESSAGE_MAX_LENGTH} символов`,
			};
		}
		const parsed = parseSendAt(input.sendAt);
		if ("error" in parsed) return { ok: false, error: parsed.error };

		const row = await insertScheduledMessage({
			memberId: context.memberId,
			kind: "widget",
			messenger: input.messenger,
			entity: input.entity,
			entityId: input.entityId,
			lineId: input.lineId,
			connectorId: input.connectorId,
			text,
			operatorId: context.bitrixSession.userId,
			sendAt: parsed.sendAt,
		});
		if (!row) return { ok: false, error: "Не удалось сохранить сообщение" };
		return { ok: true, item: toItem(row) };
	});

const listClient = bitrixProcedure
	.input(listScheduledClientMessagesSchema)
	.handler(
		async ({ input, context }): Promise<{ items: ScheduledMessageItem[] }> => {
			const rows = await listScheduledMessagesForDialog(input.messenger, [
				input.userId,
			]);
			return {
				items: rows
					.filter((row) => row.memberId === context.memberId)
					.map(toItem),
			};
		},
	);

const listWidget = bitrixProcedure
	.input(listScheduledWidgetMessagesSchema)
	.handler(
		async ({ input, context }): Promise<{ items: ScheduledMessageItem[] }> => {
			const rows = await listScheduledMessagesForEntity(
				input.entity,
				input.entityId,
			);
			return {
				items: rows
					.filter((row) => row.memberId === context.memberId)
					.map(toItem),
			};
		},
	);

/**
 * Отмена ожидающего сообщения (для упавшего — «убрать из списка»). Не
 * получится, если сообщение уже ушло или прямо сейчас отправляется.
 */
const cancel = bitrixProcedure
	.input(cancelScheduledMessageSchema)
	.handler(
		async ({ input, context }): Promise<{ ok: boolean; error?: string }> => {
			const row = await getScheduledMessage(input.id);
			// Чужой портал неотличим от несуществующего сообщения.
			if (!row || row.memberId !== context.memberId) {
				return { ok: false, error: "Сообщение не найдено" };
			}
			if (!(await cancelScheduledMessage(input.id))) {
				return {
					ok: false,
					error: "Сообщение уже отправлено или отправляется — отменить нельзя",
				};
			}
			return { ok: true };
		},
	);

export const scheduledMessagesRouter = router({
	scheduleClient,
	scheduleWidget,
	listClient,
	listWidget,
	cancel,
});

export type { ScheduledMessageItem, ScheduleMessageResult } from "./types";
