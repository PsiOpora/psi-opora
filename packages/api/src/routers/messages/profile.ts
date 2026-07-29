import {
  getBotUserProfile,
  getClientMessageStats,
} from "@psi-opora/db/queries";
import { bitrixProcedure } from "../../orpc";
import { clientThreadSchema } from "../../schemas/messages";
import type { ClientProfile } from "./types";

/** Карточка клиента для правой панели инбокса: профиль из bot_users + сводка переписки. */
export const profile = bitrixProcedure
  .input(clientThreadSchema)
  .handler(async ({ input }): Promise<{ profile: ClientProfile }> => {
    const [user, stats] = await Promise.all([
      getBotUserProfile(input.messenger, input.userId),
      getClientMessageStats(input.messenger, input.userId),
    ]);

    return {
      profile: {
        messenger: input.messenger,
        userId: input.userId,
        firstName: user?.firstName ?? null,
        lastName: user?.lastName ?? null,
        name: user?.name ?? null,
        username: user?.username ?? null,
        languageCode: user?.languageCode ?? null,
        isPremium: user?.isPremium ?? null,
        bio: user?.bio ?? null,
        avatarUrl: user?.avatarUrl ?? null,
        source: user?.source ?? null,
        campaign: user?.campaign ?? null,
        firstSeenAt: user?.firstSeenAt?.toISOString() ?? null,
        presenceStatus: user?.presenceStatus ?? null,
        messengerLastSeenAt: user?.messengerLastSeenAt?.toISOString() ?? null,
        presenceObservedAt: user?.presenceObservedAt?.toISOString() ?? null,
        lastSeenAt: user?.lastSeenAt?.toISOString() ?? null,
        stats: {
          totalCount: stats.totalCount,
          inCount: stats.inCount,
          outCount: stats.outCount,
          firstMessageAt: stats.firstMessageAt
            ? new Date(stats.firstMessageAt).toISOString()
            : null,
          lastMessageAt: stats.lastMessageAt
            ? new Date(stats.lastMessageAt).toISOString()
            : null,
        },
      },
    };
  });
