import {
  getWhatsappPersonalAccount,
  removeWhatsappPersonalAccount,
} from "@psi-opora/db/queries";
import { wahaDeleteSession } from "@psi-opora/waha";
import { publicProcedure } from "../../orpc";
import { disconnectWhatsappPersonalSchema } from "../../schemas/whatsapp-personal";
import { connectorId } from "./helpers";

export const disconnect = publicProcedure
  .input(disconnectWhatsappPersonalSchema)
  .handler(
    async ({ input, context }): Promise<{ ok?: true; error?: string }> => {
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
        // Деактивация на линии не критична — всё равно удаляем сессию ниже,
        // чтобы номер точно перестал быть доступен для отправки.
        console.error(
          `[whatsapp-personal] не удалось деактивировать линию ${input.lineId}: ${(err as Error).message}`,
        );
      }

      const account = await getWhatsappPersonalAccount(
        context.memberId,
        input.lineId,
      );
      if (account) {
        try {
          await wahaDeleteSession(account.sessionName);
        } catch (err) {
          // Сессию в WAHA удалить не удалось (контейнер недоступен?) — строку
          // всё равно убираем, чтобы вебхук перестал пересылать сообщения;
          // осиротевшую сессию можно удалить из дашборда WAHA вручную.
          console.error(
            `[whatsapp-personal] не удалось удалить WAHA-сессию ${account.sessionName}: ${(err as Error).message}`,
          );
        }
      }

      await removeWhatsappPersonalAccount(context.memberId, input.lineId);
      return { ok: true };
    },
  );
