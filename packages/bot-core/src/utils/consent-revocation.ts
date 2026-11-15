import { addClientNote, addConversationTag } from "@psi-opora/db/queries";
import { ATTENTION_TAG } from "./triage";

/**
 * Клиент попросил отозвать согласие на обработку ПДн: бот ему ответил и
 * остановил сценарий, а оператору оставляем заметку и тег «Требует внимания»
 * в инбоксе «Клиенты» — дальше обращение обрабатывает человек.
 */
export async function flagConsentRevocation(
	messenger: string,
	userId: string,
): Promise<void> {
	await addClientNote({
		messenger,
		userId,
		text: "🤖 Авто-заметка: клиент просит отозвать согласие на обработку персональных данных — нужно обработать обращение.",
	});
	await addConversationTag(messenger, userId, ATTENTION_TAG);
}
