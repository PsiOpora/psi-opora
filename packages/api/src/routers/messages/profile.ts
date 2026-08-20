import {
	getBotUserProfile,
	getClientMessageStatsForGroup,
	listGroupIdentities,
} from "@psi-opora/db/queries";
import { bitrixProcedure } from "../../orpc";
import { clientThreadSchema } from "../../schemas/messages";
import {
	type ClientProfile,
	createAvatarUrl,
	type InboxMessenger,
} from "./types";

/** Карточка клиента для правой панели инбокса: профиль из bot_users + сводка
 * переписки — по группе identity, если канал объединён с другими (см. merge.ts). */
export const profile = bitrixProcedure
	.input(clientThreadSchema)
	.handler(async ({ input }): Promise<{ profile: ClientProfile }> => {
		const identities = await listGroupIdentities(input.messenger, input.userId);
		const primary = identities[0] ?? {
			messenger: input.messenger,
			userId: input.userId,
		};
		const secondaries = identities.slice(1);

		const [user, stats] = await Promise.all([
			getBotUserProfile(primary.messenger, primary.userId),
			getClientMessageStatsForGroup(identities),
		]);

		return {
			profile: {
				messenger: input.messenger,
				userId: input.userId,
				canonicalMessenger: primary.messenger as InboxMessenger,
				canonicalUserId: primary.userId,
				linkedIdentities: secondaries.map((identity) => ({
					messenger: identity.messenger as InboxMessenger,
					userId: identity.userId,
				})),
				firstName: user?.firstName ?? null,
				lastName: user?.lastName ?? null,
				name: user?.name ?? null,
				username: user?.username ?? null,
				languageCode: user?.languageCode ?? null,
				isPremium: user?.isPremium ?? null,
				bio: user?.bio ?? null,
				avatarUrl: createAvatarUrl(
					primary.messenger,
					primary.userId,
					Boolean(user?.avatarS3Key),
				),
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
