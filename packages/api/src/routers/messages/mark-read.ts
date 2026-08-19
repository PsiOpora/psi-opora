import {
  listGroupIdentities,
  markConversationRead,
} from "@psi-opora/db/queries";
import { bitrixProcedure } from "../../orpc";
import { clientThreadSchema } from "../../schemas/messages";

/**
 * Отмечает диалог прочитанным. unreadCount в списке клиентов (см.
 * listClientsWithLastMessage) считается для каждой identity по её
 * собственному bot_conversations.lastReadAt — если канал объединён с другими
 * (см. merge.ts), сбрасываем курсор у всей группы разом, иначе бейдж
 * непрочитанных не погаснет для сообщений, пришедших по другому каналу.
 */
export const markRead = bitrixProcedure
  .input(clientThreadSchema)
  .handler(async ({ input }): Promise<{ ok: true }> => {
    const identities = await listGroupIdentities(input.messenger, input.userId);
    await Promise.all(
      identities.map((identity) =>
        markConversationRead(identity.messenger, identity.userId),
      ),
    );
    return { ok: true };
  });
