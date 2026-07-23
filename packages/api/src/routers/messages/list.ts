import { listClientsWithLastMessage } from "@psi-opora/db/queries";
import { publicProcedure } from "../../orpc";
import { listClientsSchema } from "../../schemas/messages";
import type { ClientListItem } from "./types";

export const list = publicProcedure
  .input(listClientsSchema)
  .handler(async ({ input }): Promise<{ items: ClientListItem[] }> => {
    const rows = await listClientsWithLastMessage({
      search: input.search,
      limit: input.limit,
      offset: input.offset,
    });

    return {
      items: rows.map((row) => ({
        messenger: row.messenger as ClientListItem["messenger"],
        userId: row.userId,
        name: row.name ?? row.username ?? `${row.messenger}:${row.userId}`,
        username: row.username,
        avatarUrl: row.avatarUrl,
        lastMessageText: row.lastMessageText,
        lastMessageDirection: row.lastMessageDirection,
        lastMessageAt: row.lastMessageAt.toISOString(),
        unread: row.unread,
        assignedOperatorId: row.assignedOperatorId,
        assignedOperatorName: row.assignedOperatorName,
        tags: row.tags,
      })),
    };
  });
