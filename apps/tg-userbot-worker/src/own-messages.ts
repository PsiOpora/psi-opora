import {
	botMessageExistsByExternalId,
	insertBotMessage,
	markOutgoingBotMessagesRead,
	resolveTelegramPersonalDialogUserId,
	type TelegramPersonalAccount,
	upsertBotUser,
} from "@psi-opora/db/queries";

const ECHO_SETTLE_DELAY_MS = 2000;
const SENT_IDS_LIMIT = 500;
const READ_MARKS_LIMIT = 1000;

const sentExternalIds = new Set<string>();
const readMarks = new Map<string, number>();

export function rememberSentMessage(
	connectorId: string,
	chatId: string,
	externalId: string,
): void {
	sentExternalIds.add(`${connectorId}:${chatId}:${externalId}`);
	if (sentExternalIds.size > SENT_IDS_LIMIT) {
		const oldest = sentExternalIds.values().next().value;
		if (oldest !== undefined) sentExternalIds.delete(oldest);
	}
}

export function noteReadMark(
	connectorId: string,
	chatId: string,
	maxReadId: number,
): void {
	const key = `${connectorId}:${chatId}`;
	const previous = readMarks.get(key);
	if (previous !== undefined && previous >= maxReadId) return;
	readMarks.delete(key);
	readMarks.set(key, maxReadId);
	if (readMarks.size > READ_MARKS_LIMIT) {
		const oldest = readMarks.keys().next().value;
		if (oldest !== undefined) readMarks.delete(oldest);
	}
}

export async function logOwnDeviceMessage(
	account: TelegramPersonalAccount,
	message: {
		chatId: string;
		messageId: string;
		text: string;
		createdAt?: Date;
		profile?: {
			firstName?: string;
			lastName?: string;
			username?: string | null;
			isPremium?: boolean;
		};
		media?: {
			kind: "image" | "file";
			mediaS3Key: string;
			mediaMimeType?: string;
			mediaFileName?: string;
		};
	},
): Promise<void> {
	try {
		await new Promise((resolve) => setTimeout(resolve, ECHO_SETTLE_DELAY_MS));
		const userId = await resolveTelegramPersonalDialogUserId(
			message.chatId,
			account.connectorId,
		);
		if (
			sentExternalIds.has(
				`${account.connectorId}:${message.chatId}:${message.messageId}`,
			) ||
			(await botMessageExistsByExternalId({
				messenger: "telegram-personal",
				connectorId: account.connectorId,
				externalId: message.messageId,
				userId,
				externalChatId: message.chatId,
			}))
		) {
			return;
		}

		await upsertBotUser({
			messenger: "telegram-personal",
			userId,
			firstName: message.profile?.firstName,
			lastName: message.profile?.lastName,
			username: message.profile?.username ?? undefined,
			isPremium: message.profile?.isPremium,
		});
		await insertBotMessage({
			messenger: "telegram-personal",
			userId,
			direction: "out",
			source: "operator",
			operatorName: "Из приложения Telegram",
			text: message.text,
			externalId: message.messageId,
			externalChatId: message.chatId,
			connectorId: account.connectorId,
			createdAt: message.createdAt,
			...message.media,
		});

		const maxReadId = readMarks.get(`${account.connectorId}:${message.chatId}`);
		if (maxReadId !== undefined && Number(message.messageId) <= maxReadId) {
			await markOutgoingBotMessagesRead({
				messenger: "telegram-personal",
				connectorId: account.connectorId,
				chatIds: [message.chatId],
				upToExternalId: maxReadId,
			});
		}
	} catch (error) {
		console.error(
			`[tg-userbot-worker] ошибка журналирования своего сообщения: ${(error as Error).message}`,
		);
	}
}
