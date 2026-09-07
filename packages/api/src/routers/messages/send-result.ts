import type { BotMessageEntry } from "@psi-opora/db/queries";

export type SendClientMessageProcedureResult =
	| { ok: true; id: string }
	| { ok: false; error: string };

type InsertBotMessage = (entry: BotMessageEntry) => Promise<string | undefined>;

const MESSAGE_PERSISTENCE_ERROR =
	"Сообщение отправлено, но не удалось сохранить его в истории. Обновите диалог перед повторной отправкой.";

export async function persistSentMessage(
	entry: BotMessageEntry,
	insertBotMessage: InsertBotMessage,
): Promise<SendClientMessageProcedureResult> {
	try {
		const id = await insertBotMessage(entry);
		if (!id) {
			throw new Error("insertBotMessage did not return an id");
		}
		return { ok: true, id };
	} catch (err) {
		console.error(
			`[messages] не удалось записать сообщение в журнал: ${(err as Error).message}`,
		);
		return { ok: false, error: MESSAGE_PERSISTENCE_ERROR };
	}
}
