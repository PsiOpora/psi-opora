import { assignConversation } from "@psi-opora/db/queries";
import { publicProcedure } from "../../orpc";
import { assignConversationSchema } from "../../schemas/messages";

/**
 * Назначает ответственного менеджера на диалог. operatorId/operatorName
 * приходят с клиента (см. apps/dashboard — b24.callMethod("user.current")) —
 * сервер их не проверяет: в этой архитектуре нет способа подтвердить личность
 * конкретного пользователя портала иначе, чем уже доверяет весь iframe.
 */
export const assign = publicProcedure
  .input(assignConversationSchema)
  .handler(async ({ input }): Promise<{ ok: true }> => {
    await assignConversation({
      messenger: input.messenger,
      userId: input.userId,
      operatorId: input.operatorId,
      operatorName: input.operatorName,
    });
    return { ok: true };
  });
