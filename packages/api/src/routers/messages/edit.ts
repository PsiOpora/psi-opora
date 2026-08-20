import {
	getEditableBotMessage,
	updateBotMessageText,
} from "@psi-opora/db/queries";
import { editMessengerMessage, formatMessengerError } from "@psi-opora/jobs";
import { bitrixProcedure } from "../../orpc";
import { editClientMessageSchema } from "../../schemas/messages";
import { type ClientMessageItem, toClientMessageItem } from "./types";

const MAX_EDIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const edit = bitrixProcedure
	.input(editClientMessageSchema)
	.handler(
		async ({
			input,
			context,
		}): Promise<{ message?: ClientMessageItem; error?: string }> => {
			const text = input.text.trim();
			const operatorId = context.bitrixSession.userId;
			const row = await getEditableBotMessage(input.messageId, operatorId);

			if (
				!row ||
				(row.messenger !== "telegram" && row.messenger !== "max") ||
				!row.externalId
			) {
				return {
					error:
						"Сообщение нельзя изменить: оно отправлено другим оператором или не содержит внешний ID",
				};
			}
			if (
				row.messenger === "max" &&
				Date.now() - row.createdAt.getTime() >= MAX_EDIT_WINDOW_MS
			) {
				return {
					error:
						"MAX позволяет изменять обычные сообщения только в течение 7 суток",
				};
			}
			if (row.text === text) {
				return { message: toClientMessageItem(row, operatorId) };
			}

			try {
				await editMessengerMessage(
					row.messenger,
					row.userId,
					row.externalId,
					text,
				);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(
					`[messages] не удалось изменить ${row.messenger} message=${row.externalId}: ${message}`,
				);
				return {
					error: `Не изменено: ${formatMessengerError(message)}`,
				};
			}

			const updated = await updateBotMessageText(row.id, text);
			if (!updated) {
				return {
					error:
						"Сообщение изменено в мессенджере, но локальная история не обновилась — перезагрузите диалог",
				};
			}
			return { message: toClientMessageItem(updated, operatorId) };
		},
	);
