import {
	getConversationDeletionVersionForGroup,
	listAllBotMessagesForGroup,
	listGroupIdentities,
} from "@psi-opora/db/queries";
import { bitrixProcedure } from "../../orpc";
import { clientThreadSchema } from "../../schemas/messages";
import {
	type ClientMessageItem,
	type ClientThreadChannel,
	type InboxMessenger,
	toClientMessageItem,
} from "./types";

export const thread = bitrixProcedure.input(clientThreadSchema).handler(
	async ({
		input,
		context,
	}): Promise<{
		messages: ClientMessageItem[];
		deletionVersion: string;
		/** Все каналы клиента (с учётом объединения) — куда можно ответить. */
		channels: ClientThreadChannel[];
	}> => {
		const identities = await listGroupIdentities(input.messenger, input.userId);
		const deletionVersion =
			await getConversationDeletionVersionForGroup(identities);
		const rows = await listAllBotMessagesForGroup(identities);

		return {
			deletionVersion,
			channels: identities.map((identity) => ({
				messenger: identity.messenger as InboxMessenger,
				userId: identity.userId,
			})),
			messages: rows
				.map((row) => toClientMessageItem(row, context.bitrixSession.userId))
				.reverse(),
		};
	},
);
