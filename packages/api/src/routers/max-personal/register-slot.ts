import { publicProcedure } from "../../orpc";
import { generateMaxConnectorId } from "./helpers";

export const registerSlot = publicProcedure.handler(
	async ({ context }): Promise<{ connectorId?: string; error?: string }> =>
		context.memberId
			? { connectorId: generateMaxConnectorId() }
			: { error: "Нет активной сессии Битрикс24 — обновите страницу" },
);
