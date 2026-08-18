import { insertBotMessage } from "@psi-opora/db/queries";
import { formatMessengerError, sendMessengerMessage } from "@psi-opora/jobs";
import { publicProcedure } from "../../orpc";
import { sendTestMessageSchema } from "../../schemas/broadcast";

/** Тестовая отправка текущего текста одному получателю из предпросмотра. */
export const sendTest = publicProcedure
  .input(sendTestMessageSchema)
  .handler(async ({ input }) => {
    const message = input.message.trim();
    if (!message) return { ok: false, error: "Текст сообщения пуст" };
    if (!input.userId) {
      return { ok: false, error: "У контакта нет ID мессенджера" };
    }

    try {
      const externalId = await sendMessengerMessage(
        input.messenger,
        input.userId,
        message,
      );
      // Тестовое сообщение уходит реальному клиенту, поэтому оно должно быть
      // видно в истории диалога — иначе оператор, открывший инбокс, не поймёт,
      // откуда у клиента текст рассылки. Ошибка записи тест не проваливает.
      await insertBotMessage({
        messenger: input.messenger,
        userId: input.userId,
        direction: "out",
        source: "broadcast",
        text: message,
        status: "sent",
        externalId,
      }).catch((err: unknown) => {
        console.error(
          `[broadcast] не удалось записать тестовое сообщение в журнал: ${(err as Error).message}`,
        );
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: formatMessengerError((err as Error).message) };
    }
  });
