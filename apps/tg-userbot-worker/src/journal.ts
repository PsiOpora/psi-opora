import {
	assignConversationIfUnassigned,
	botMessageExistsByExternalId,
	insertBotMessage,
	resolveTelegramPersonalDialogUserId,
	upsertBotUser,
} from "@psi-opora/db/queries";
import {
	deferTelegramJournal,
	type TelegramJournalEntry,
} from "@psi-opora/tg-userbot";

export async function writeTelegramJournal(
	entry: TelegramJournalEntry,
	id?: string,
): Promise<void> {
	const { profile, createdAt, ...message } = entry;
	const messenger = "telegram-personal";
	let userId: string;
	try {
		userId = await resolveTelegramPersonalDialogUserId(
			entry.externalChatId,
			entry.connectorId,
		);
	} catch (error) {
		if (id) throw error; // Запись уже находится в очереди Redis.
		await deferTelegramJournal(entry, error);
		return;
	}
	if (
		profile &&
		entry.externalId &&
		(await botMessageExistsByExternalId({
			messenger,
			connectorId: entry.connectorId,
			externalId: entry.externalId,
			userId,
			externalChatId: entry.externalChatId,
		}))
	) {
		return;
	}
	if (profile) {
		await upsertBotUser({
			messenger,
			userId,
			...profile,
			username: profile.username ?? undefined,
		});
	}

	await insertBotMessage(
		{ ...message, id, messenger, userId, createdAt: new Date(createdAt) },
		id ? { ignoreDuplicateId: true } : undefined,
	);

	if (entry.operatorId !== undefined) {
		await assignConversationIfUnassigned({
			messenger,
			userId,
			operatorId: entry.operatorId,
			operatorName: `Оператор #${entry.operatorId}`,
		});
	}
}
