import { sendMessengerMessage } from "@psi-opora/jobs";
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
      await sendMessengerMessage(input.messenger, input.userId, message);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
