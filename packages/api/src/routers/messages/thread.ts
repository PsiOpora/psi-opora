import { listAllBotMessages } from "@psi-opora/db/queries";
import { bitrixProcedure } from "../../orpc";
import { clientThreadSchema } from "../../schemas/messages";
import { type ClientMessageItem, toClientMessageItem } from "./types";

export const thread = bitrixProcedure
	.input(clientThreadSchema)
	.handler(
		async ({ input, context }): Promise<{ messages: ClientMessageItem[] }> => {
			const rows = await listAllBotMessages(input.messenger, input.userId);

			return {
				messages: rows
					.map((row) => toClientMessageItem(row, context.bitrixSession.userId))
					.reverse(),
			};
		},
	);
