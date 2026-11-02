import {
	botMessageExistsByExternalId,
	insertBotMessage,
	type MaxPersonalAccount,
	markOutgoingBotMessagesRead,
	upsertBotUser,
} from "@psi-opora/db/queries";

/**
 * Сообщения, которые владелец аккаунта написал клиенту напрямую из MAX
 * (телефон/десктоп), а не через приложение. MAX присылает их тем же пушем
 * NOTIF_MESSAGE, где отправитель — сам аккаунт. Они попадают в историю
 * диалога как исходящие; в Открытую линию Bitrix24 не пересылаются —
 * imconnector.send.messages принимает только сообщения от клиента.
 *
 * Тот же пуш приходит и как эхо сообщений, отправленных через приложение, —
 * их в историю второй раз не пишем.
 */

/** Эхо может прийти раньше, чем очередь запишет externalId в журнал. */
const ECHO_SETTLE_DELAY_MS = 2000;
const SENT_IDS_LIMIT = 500;

const sentExternalIds = new Set<string>();

/** Запоминает id сообщения, отправленного воркером, — чтобы узнать его эхо. */
export function rememberSentMessage(externalId: string): void {
	sentExternalIds.add(externalId);
	if (sentExternalIds.size > SENT_IDS_LIMIT) {
		const oldest = sentExternalIds.values().next().value;
		if (oldest !== undefined) sentExternalIds.delete(oldest);
	}
}

/**
 * Последняя отметка прочтения по чату: она может прийти, пока сообщение ещё
 * ждёт отложенной записи, — тогда статус «прочитано» применяем после вставки.
 */
const readMarks = new Map<string, Date>();
const READ_MARKS_LIMIT = 1000;

export function noteReadMark(
	connectorId: string,
	chatId: string,
	readAt: Date,
): void {
	const key = `${connectorId}:${chatId}`;
	const previous = readMarks.get(key);
	if (previous && previous >= readAt) return;
	readMarks.delete(key);
	readMarks.set(key, readAt);
	if (readMarks.size > READ_MARKS_LIMIT) {
		const oldest = readMarks.keys().next().value;
		if (oldest !== undefined) readMarks.delete(oldest);
	}
}

export async function logOwnDeviceMessage(
	account: MaxPersonalAccount,
	message: { chatId: string; messageId: string | null; text: string },
): Promise<void> {
	try {
		const { messageId } = message;
		const receivedAt = new Date();
		if (messageId) {
			await new Promise((resolve) => setTimeout(resolve, ECHO_SETTLE_DELAY_MS));
			if (
				sentExternalIds.has(messageId) ||
				(await botMessageExistsByExternalId({
					messenger: "max-personal",
					connectorId: account.connectorId,
					externalId: messageId,
				}))
			) {
				return;
			}
		}
		await upsertBotUser({ messenger: "max-personal", userId: message.chatId });
		await insertBotMessage({
			messenger: "max-personal",
			userId: message.chatId,
			direction: "out",
			source: "operator",
			operatorName: "Из приложения MAX",
			text: message.text,
			externalId: messageId ?? undefined,
			connectorId: account.connectorId,
			createdAt: receivedAt,
		});
		const readAt = readMarks.get(`${account.connectorId}:${message.chatId}`);
		if (readAt && readAt >= receivedAt) {
			await markOutgoingBotMessagesRead({
				messenger: "max-personal",
				connectorId: account.connectorId,
				chatIds: [message.chatId],
				upToTime: readAt,
			});
		}
	} catch (error) {
		console.error(
			`[max-userbot-worker] ошибка журналирования своего сообщения: ${(error as Error).message}`,
		);
	}
}
