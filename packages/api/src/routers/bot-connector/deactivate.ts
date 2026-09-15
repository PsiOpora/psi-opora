import { logger } from "@psi-opora/config";
import { getBotConnector, removeBotConnector } from "@psi-opora/db/queries";
import { publicProcedure } from "../../orpc";
import { deactivateBotConnectorSchema } from "../../schemas/bot-connector";

/**
 * Отключает канал бота от линии. Намеренно не трогает вебхук бота —
 * бот должен продолжать отвечать на входящие независимо от того, дублируется
 * ли переписка в Открытую линию.
 */
export const deactivate = publicProcedure
	.input(deactivateBotConnectorSchema)
	.handler(
		async ({ input, context }): Promise<{ ok?: true; error?: string }> => {
			let config: Awaited<ReturnType<typeof getBotConnector>>;
			try {
				config = await getBotConnector(input.messenger);
			} catch (err) {
				logger.error(
					"bot-connector.deactivate: не удалось прочитать коннектор из БД",
					err,
					{
						messenger: input.messenger,
					},
				);
				return {
					error: `Не удалось прочитать канал из базы данных: ${(err as Error).message}`,
				};
			}
			if (!config) return { ok: true };

			try {
				const api = await context.getBitrixApi();
				if (api) {
					await api.call("imconnector.activate", {
						CONNECTOR: config.connectorId,
						LINE: Number(config.openLineId),
						ACTIVE: "N",
					});
				}
			} catch (err) {
				logger.error(
					`bot-connector.deactivate: не удалось деактивировать линию ${config.openLineId}`,
					err,
					{
						messenger: input.messenger,
					},
				);
			}

			try {
				await removeBotConnector(input.messenger);
			} catch (err) {
				logger.error(
					"bot-connector.deactivate: не удалось удалить коннектор из БД",
					err,
					{
						messenger: input.messenger,
					},
				);
				return {
					error: `Не удалось удалить канал из базы данных: ${(err as Error).message}`,
				};
			}
			return { ok: true };
		},
	);
