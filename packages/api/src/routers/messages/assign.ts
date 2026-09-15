import {
	assignConversation,
	resolveCanonicalIdentity,
} from "@psi-opora/db/queries";
import { bitrixProcedure } from "../../orpc";
import { assignConversationSchema } from "../../schemas/messages";

/**
 * Назначает ответственного менеджера на диалог. operatorId/operatorName
 * приходят с клиента (см. apps/dashboard — b24.actions.v2.call.make("user.current")) —
 * сервер их не проверяет: в этой архитектуре нет способа подтвердить личность
 * конкретного пользователя портала иначе, чем уже доверяет весь iframe.
 * Пишет всегда на канонического клиента (см. merge.ts).
 */
export const assign = bitrixProcedure
	.input(assignConversationSchema)
	.handler(async ({ input }): Promise<{ ok: true }> => {
		const primary = await resolveCanonicalIdentity(
			input.messenger,
			input.userId,
		);
		await assignConversation({
			messenger: primary.messenger,
			userId: primary.userId,
			operatorId: input.operatorId,
			operatorName: input.operatorName,
		});
		return { ok: true };
	});
