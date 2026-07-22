import { markConversationRead } from "@psi-opora/db/queries";
import { publicProcedure } from "../../orpc";
import { clientThreadSchema } from "../../schemas/messages";

export const markRead = publicProcedure
  .input(clientThreadSchema)
  .handler(async ({ input }): Promise<{ ok: true }> => {
    await markConversationRead(input.messenger, input.userId);
    return { ok: true };
  });
