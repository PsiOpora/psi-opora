import { listBotMessages } from "@psi-opora/db/queries";
import { bitrixProcedure } from "../../orpc";
import { clientThreadSchema } from "../../schemas/messages";
import { HISTORY_LIMIT } from "../widget-message/helpers";
import { type ClientMessageItem, toClientMessageItem } from "./types";

export const thread = bitrixProcedure
  .input(clientThreadSchema)
  .handler(async ({ input }): Promise<{ messages: ClientMessageItem[] }> => {
    const rows = await listBotMessages(
      input.messenger,
      input.userId,
      HISTORY_LIMIT,
    );

    return {
      messages: rows.map(toClientMessageItem).reverse(),
    };
  });
