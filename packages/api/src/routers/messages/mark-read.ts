import { markConversationRead } from "@psi-opora/db/queries";
import { bitrixProcedure } from "../../orpc";
import { clientThreadSchema } from "../../schemas/messages";

export const markRead = bitrixProcedure
  .input(clientThreadSchema)
  .handler(async ({ input }): Promise<{ ok: true }> => {
    await markConversationRead(input.messenger, input.userId);
    return { ok: true };
  });
