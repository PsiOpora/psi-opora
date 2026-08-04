import {
	getMaxPersonalAccountByConnector,
	removeMaxPersonalAccount,
} from "@psi-opora/db/queries";
import { publicProcedure } from "../../orpc";
import { disconnectMaxPersonalSchema } from "../../schemas/max-personal";

export const disconnect = publicProcedure
	.input(disconnectMaxPersonalSchema)
	.handler(
		async ({ input, context }): Promise<{ ok?: true; error?: string }> => {
			if (!context.memberId) return { error: "Нет активной сессии Битрикс24" };
			const account = await getMaxPersonalAccountByConnector(
				input.connectorId,
				input.lineId,
			);
			if (!account || account.memberId !== context.memberId) {
				return { error: "Номер не найден" };
			}
			try {
				const api = await context.getBitrixApi();
				await api?.call("imconnector.activate", {
					CONNECTOR: input.connectorId,
					LINE: Number(input.lineId),
					ACTIVE: "N",
				});
			} catch (error) {
				console.error(
					`[max-personal] ошибка деактивации: ${(error as Error).message}`,
				);
			}
			await removeMaxPersonalAccount(
				context.memberId,
				input.lineId,
				input.connectorId,
			);
			return { ok: true };
		},
	);
