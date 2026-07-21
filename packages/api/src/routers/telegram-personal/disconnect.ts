import { removeTelegramPersonalAccount } from "@psi-opora/db/queries";
import { publicProcedure } from "../../orpc";
import { disconnectTelegramPersonalSchema } from "../../schemas/telegram-personal";
import { connectorId } from "./helpers";

export const disconnect = publicProcedure
  .input(disconnectTelegramPersonalSchema)
  .handler(async ({ input, context }): Promise<{ ok?: true; error?: string }> => {
    if (!context.memberId) {
      return { error: "Нет активной сессии Битрикс24 — обновите страницу" };
    }

    try {
      const api = await context.getBitrixApi();
      if (api) {
        await api.call("imconnector.activate", {
          CONNECTOR: connectorId(),
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

    await removeTelegramPersonalAccount(context.memberId, input.lineId);
    return { ok: true };
  });
