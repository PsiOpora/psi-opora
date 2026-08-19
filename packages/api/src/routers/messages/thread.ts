import {
	listAllBotMessagesForGroup,
	listGroupIdentities,
} from "@psi-opora/db/queries";
import { bitrixProcedure } from "../../orpc";
import { clientThreadSchema } from "../../schemas/messages";
import { type ClientMessageItem, toClientMessageItem } from "./types";

export const thread = bitrixProcedure
	.input(clientThreadSchema)
	.handler(
		async ({ input, context }): Promise<{ messages: ClientMessageItem[] }> => {
			const identities = await listGroupIdentities(
				input.messenger,
				input.userId,
			);
			const rows = await listAllBotMessagesForGroup(identities);

			return {
				messages: rows
					.map((row) => toClientMessageItem(row, context.bitrixSession.userId))
					.reverse(),
			};
		},
	);
