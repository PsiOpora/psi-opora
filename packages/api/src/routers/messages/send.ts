import { insertBotMessage, listTelegramPersonalAccounts } from "@psi-opora/db/queries";
import { sendMessengerMessage } from "@psi-opora/jobs";
import { publicProcedure } from "../../orpc";
import { sendClientMessageSchema } from "../../schemas/messages";
import { sendViaPersonalNumber } from "../widget-message/helpers";

/**
 * Отправляет сообщение клиенту из единого инбокса («Клиенты»). В отличие от
 * вкладки CRM (widget-message/send.ts) канал уже надёжно известен — это тот
 * же messenger/userId, что и у выбранной строки списка (bot_users), поход в
 * CRM за резолвингом контакта не нужен. Комментарий в таймлайн CRM тоже не
 * пишем — здесь нет известного contactId, а история и так видна в инбоксе.
 */
export const send = publicProcedure
  .input(sendClientMessageSchema)
  .handler(
    async ({ input, context }): Promise<{ ok?: true; error?: string }> => {
      const text = input.text.trim();
      if (!text) return { error: "Введите текст сообщения" };

      if (input.messenger === "telegram-personal") {
        if (!context.memberId) {
          return { error: "Нет активной сессии Битрикс24 — обновите страницу" };
        }
        let openLineId = input.lineId;
        if (!openLineId) {
          const accounts = (
            await listTelegramPersonalAccounts(context.memberId)
          ).filter((a) => a.status === "connected");
          if (accounts.length === 0) {
            return { error: "Личный номер Telegram не подключён" };
          }
          if (accounts.length > 1) {
            return {
              error:
                "На портале несколько личных номеров Telegram — отправка из единого инбокса пока поддерживает один",
            };
          }
          const account = accounts[0];
          if (!account) return { error: "Личный номер Telegram не подключён" };
          openLineId = account.openLineId;
        }

        const result = await sendViaPersonalNumber({
          memberId: context.memberId,
          openLineId,
          // Существующий диалог уже адресован этим userId при первом резолве
          // (packages/api/src/routers/widget-message/helpers.ts) — по
          // умолчанию это телефон, как и в остальном коде.
          target: { kind: "phone", value: input.userId },
          text,
        });
        if (result.error) return result;
      } else {
        try {
          await sendMessengerMessage(input.messenger, input.userId, text);
        } catch (err) {
          const error = err as Error;
          console.error(
            `[messages] ошибка отправки ${input.messenger}: ${error.message}`,
            error.cause ?? "",
          );
          return { error: `Не отправлено: ${error.message}` };
        }
      }

      try {
        await insertBotMessage({
          messenger: input.messenger,
          userId: input.userId,
          direction: "out",
          source: "widget",
          text,
        });
      } catch (err) {
        console.error(
          `[messages] не удалось записать сообщение в журнал: ${(err as Error).message}`,
        );
      }

      return { ok: true };
    },
  );
