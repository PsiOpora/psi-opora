import {
	getTelegramPersonalAccountByConnector,
	removeTelegramPersonalAccount,
} from "@psi-opora/db/queries";
import { publicProcedure } from "../../orpc";
import { disconnectTelegramPersonalSchema } from "../../schemas/telegram-personal";

export const disconnect = publicProcedure
	.input(disconnectTelegramPersonalSchema)
	.handler(
		async ({ input, context }): Promise<{ ok?: true; error?: string }> => {
			if (!context.memberId) {
				return { error: "Нет активной сессии Битрикс24 — обновите страницу" };
			}

			// Проверяем, что коннектор/линия действительно принадлежат этому
			// порталу, прежде чем дёргать Bitrix API его значениями — lineId и
			// connectorId приходят от клиента, а imconnector.activate не проверяет
			// сам, что переданный CONNECTOR относится к вызывающему порталу.
			const account = await getTelegramPersonalAccountByConnector(
				input.connectorId,
				input.lineId,
			);
			if (!account || account.memberId !== context.memberId) {
				return { error: "Номер не найден" };
			}

			try {
				const api = await context.getBitrixApi();
				if (api) {
					await api.call("imconnector.activate", {
						CONNECTOR: input.connectorId,
						LINE: Number(input.lineId),
						ACTIVE: "N",
					});
				}
			} catch (err) {
				// Деактивация на линии не критична — всё равно чистим сессию ниже,
				// чтобы аккаунт точно перестал быть доступен для отправки.
				console.error(
					`[telegram-personal] не удалось деактивировать линию ${input.lineId}: ${(err as Error).message}`,
				);
			}

			await removeTelegramPersonalAccount(
				context.memberId,
				input.lineId,
				input.connectorId,
			);
			return { ok: true };
		},
	);
