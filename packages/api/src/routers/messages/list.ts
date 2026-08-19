import {
  listClientsWithLastMessage,
  upsertBotUser,
} from "@psi-opora/db/queries";
import { bitrixProcedure } from "../../orpc";
import { listClientsSchema } from "../../schemas/messages";
import { resolveCrmContactName } from "./crm-contact";
import { type ClientListItem, createAvatarUrl } from "./types";

/**
 * Сколько строк без имени/username за один запрос пробуем обогатить именем
 * CRM-контакта — ограничение защищает время ответа и Bitrix API от нагрузки,
 * когда «безымянных» диалогов много. Остальные строки подхватятся на
 * следующих поллах списка (см. LIST_POLL_INTERVAL_MS в inbox-app.tsx).
 */
const MAX_CRM_NAME_LOOKUPS_PER_REQUEST = 5;

export const list = bitrixProcedure
  .input(listClientsSchema)
  .handler(async ({ input, context }): Promise<{ items: ClientListItem[] }> => {
    const rows = await listClientsWithLastMessage({
      search: input.search,
      limit: input.limit,
      offset: input.offset,
    });

    const api = await context.getBitrixApi();
    let lookupsLeft = MAX_CRM_NAME_LOOKUPS_PER_REQUEST;

    const names = await Promise.all(
      rows.map(async (row) => {
        if (row.name || row.username) return row.name ?? row.username;
        if (!api || lookupsLeft <= 0) return null;
        lookupsLeft--;

        const messenger = row.messenger as ClientListItem["messenger"];
        const crmName = await resolveCrmContactName(
          api,
          context.memberId,
          messenger,
          row.userId,
        );
        if (crmName) {
          await upsertBotUser({
            messenger: row.messenger,
            userId: row.userId,
            name: crmName,
          }).catch(() => {});
        }
        return crmName;
      }),
    );

    return {
      items: rows.map((row, i) => ({
        messenger: row.messenger as ClientListItem["messenger"],
        userId: row.userId,
        name: names[i] ?? `${row.messenger}:${row.userId}`,
        username: row.username,
        avatarUrl: createAvatarUrl(
          row.messenger,
          row.userId,
          row.hasAvatar,
        ),
        lastMessageText: row.lastMessageText,
        lastMessageDirection: row.lastMessageDirection,
        lastMessageAt: row.lastMessageAt.toISOString(),
        unread: row.unread,
        unreadCount: row.unreadCount,
        assignedOperatorId: row.assignedOperatorId,
        assignedOperatorName: row.assignedOperatorName,
        tags: row.tags,
        linkedChannels: row.linkedChannels as ClientListItem["linkedChannels"],
      })),
    };
  });
