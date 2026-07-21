import {
  markBotConnectorWebhookConfigured,
  upsertBotConnector,
} from "@psi-opora/db/queries";
import { setMessengerWebhook } from "@psi-opora/jobs";
import { publicProcedure } from "../../orpc";
import { activateBotConnectorSchema } from "../../schemas/bot-connector";
import { connectorId } from "./helpers";

/**
 * Вызывается виджетом настроек канала (apps/dashboard/.../widget/bot-connector) —
 * администратор добавил наш коннектор на линию в Контакт-центре, Bitrix
 * открыл наш PLACEMENT_HANDLER, и мы: 1) активируем линию, 2) сохраняем
 * connector/line в БД (packages/bot-core читает их в sendMessageToOpenLine),
 * 3) автоматически настраиваем вебхук бота на наш деплой (setMessengerWebhook) —
 * раньше это был ручной скрипт (set-webhook.ts).
 */
export const activate = publicProcedure
  .input(activateBotConnectorSchema)
  .handler(
    async ({
      input,
      context,
    }): Promise<{ ok?: true; error?: string; webhookError?: string }> => {
      if (!context.memberId) {
        return { error: "Нет активной сессии Битрикс24 — обновите страницу" };
      }

      const api = await context.getBitrixApi();
      if (!api) {
        return { error: "Нет подключения к Битрикс24 — обновите страницу" };
      }

      try {
        await api.call("imconnector.activate", {
          CONNECTOR: connectorId(input.messenger),
          LINE: Number(input.lineId),
          ACTIVE: "Y",
        });
      } catch (err) {
        return { error: (err as Error).message };
      }

      await upsertBotConnector({
        messenger: input.messenger,
        memberId: context.memberId,
        openLineId: input.lineId,
        connectorId: connectorId(input.messenger),
      });

      try {
        await setMessengerWebhook(input.messenger);
        await markBotConnectorWebhookConfigured(input.messenger);
      } catch (err) {
        // Линия уже активирована и сохранена — вебхук можно перенастроить
        // отдельно (повторной активацией), это не откатывает предыдущие шаги.
        return { ok: true, webhookError: (err as Error).message };
      }

      return { ok: true };
    },
  );
