import {
  listBotMessagesSinceForGroup,
  listGroupIdentities,
} from "@psi-opora/db/queries";
import { bitrixProcedure } from "../../orpc";
import { clientPollSchema } from "../../schemas/messages";
import { type ClientMessageItem, toClientMessageItem } from "./types";

/** Новые сообщения диалога после `sinceIso` — поллинг открытого диалога в инбоксе. */
export const poll = bitrixProcedure
  .input(clientPollSchema)
  .handler(
    async ({
      input,
      context,
    }): Promise<{ messages?: ClientMessageItem[]; error?: string }> => {
      const since = new Date(input.sinceIso);
      if (Number.isNaN(since.getTime())) return { error: "Некорректная дата" };

      const identities = await listGroupIdentities(
        input.messenger,
        input.userId,
      );
      const rows = await listBotMessagesSinceForGroup(identities, since);

      return {
        messages: rows.map((row) =>
          toClientMessageItem(row, context.bitrixSession.userId),
        ),
      };
    },
  );
