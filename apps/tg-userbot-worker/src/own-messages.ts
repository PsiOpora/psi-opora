import {
	markOutgoingBotMessagesRead,
	type TelegramPersonalAccount,
} from "@psi-opora/db/queries";
import { writeTelegramJournal } from "./journal";

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

export async function applyOutboxReadMark(
	connectorId: string,
	chatId: string,
	messageId: string,
): Promise<void> {
	const maxReadId = readMarks.get(`${connectorId}:${chatId}`);
	if (maxReadId !== undefined && Number(messageId) <= maxReadId) {
		await markOutgoingBotMessagesRead({
			messenger: "telegram-personal",
			connectorId,
			chatIds: [chatId],
			upToExternalId: maxReadId,
		});
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
		if (
			sentExternalIds.has(
				`${account.connectorId}:${message.chatId}:${message.messageId}`,
			)
		) {
			return;
		}
		await writeTelegramJournal({
			direction: "out",
			source: "operator",
			operatorName: "Из приложения Telegram",
			text: message.text,
			externalId: message.messageId,
			externalChatId: message.chatId,
			connectorId: account.connectorId,
			createdAt: message.createdAt?.getTime() ?? Date.now(),
			profile: message.profile ?? {},
			...message.media,
		});
		await applyOutboxReadMark(
			account.connectorId,
			message.chatId,
			message.messageId,
		);
	} catch (error) {
		console.error(
			`[tg-userbot-worker] ошибка журналирования своего сообщения: ${(error as Error).message}`,
		);
	}
}
