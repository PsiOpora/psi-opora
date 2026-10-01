import {
	deleteConversationsForGroup,
	listGroupIdentities,
} from "@psi-opora/db/queries";
import { bitrixProcedure } from "../../orpc";
import { clientThreadSchema } from "../../schemas/messages";

/**
 * Удаляет диалог из инбокса «Клиенты» (мягко, см. deleteConversation в
 * packages/db). У клиента в мессенджере и в Открытой линии Bitrix24 ничего
 * не удаляется. Если канал объединён с другими (см. merge.ts), удаляются
 * все каналы группы разом — иначе карточка клиента осталась бы в списке
 * с перепиской из соседнего канала.
 */
export const deleteConversation = bitrixProcedure
	.input(clientThreadSchema)
	.handler(async ({ input, context }): Promise<{ ok: true }> => {
		const operatorId = context.bitrixSession.userId;
		const identities = await listGroupIdentities(input.messenger, input.userId);
		await deleteConversationsForGroup(identities, operatorId);
		return { ok: true };
	});
