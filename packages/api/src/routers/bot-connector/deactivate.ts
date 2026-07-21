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
  .handler(async ({ input, context }): Promise<{ ok?: true; error?: string }> => {
    const config = await getBotConnector(input.messenger);
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
      console.error(
        `[bot-connector] не удалось деактивировать линию ${config.openLineId}: ${(err as Error).message}`,
      );
    }

    await removeBotConnector(input.messenger);
    return { ok: true };
  });
