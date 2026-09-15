import {
	mergeClientIdentities,
	unmergeClientIdentity,
} from "@psi-opora/db/queries";
import { bitrixProcedure } from "../../orpc";
import { clientThreadSchema, mergeClientsSchema } from "../../schemas/messages";
import type { InboxMessenger } from "./types";

/** Объединяет канал (messenger,userId) с другим клиентом — см. client-identity-links.ts. */
export const mergeClients = bitrixProcedure
	.input(mergeClientsSchema)
	.handler(
		async ({
			input,
		}): Promise<{ primary: { messenger: InboxMessenger; userId: string } }> => {
			const primary = await mergeClientIdentities({
				messenger: input.messenger,
				userId: input.userId,
				intoMessenger: input.intoMessenger,
				intoUserId: input.intoUserId,
				operatorId: input.operatorId,
				operatorName: input.operatorName,
			});
			return {
				primary: {
					messenger: primary.messenger as InboxMessenger,
					userId: primary.userId,
				},
			};
		},
	);

/** Расцепляет ранее объединённый канал — он снова независимый клиент. */
export const unmergeClient = bitrixProcedure
	.input(clientThreadSchema)
	.handler(async ({ input }): Promise<{ ok: true }> => {
		await unmergeClientIdentity(input.messenger, input.userId);
		return { ok: true };
	});
