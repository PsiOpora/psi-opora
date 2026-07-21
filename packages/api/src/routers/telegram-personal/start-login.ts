import { sendLoginCode } from "@psi-opora/tg-userbot";
import { publicProcedure } from "../../orpc";
import { startTelegramLoginSchema } from "../../schemas/telegram-personal";
import { savePendingTelegramLogin } from "./helpers";

/**
 * Первый шаг логина личного Telegram-номера (placement настроек коннектора
 * Открытых линий, см. apps/dashboard/.../tg-personal-connector). Отправляет
 * код через mtcute и сохраняет промежуточное состояние в Redis — сырые
 * данные сессии на фронт не уходят, только `loginId`.
 */
export const startLogin = publicProcedure
  .input(startTelegramLoginSchema)
  .handler(
    async ({ input, context }): Promise<{ loginId?: string; error?: string }> => {
      const memberId = context.memberId;
      if (!memberId) {
        return { error: "Нет активной сессии Битрикс24 — обновите страницу" };
      }

      try {
        const { pendingSession, phoneCodeHash } = await sendLoginCode(
          input.phone,
          { apiId: input.apiId, apiHash: input.apiHash },
        );
        const loginId = crypto.randomUUID();
        await savePendingTelegramLogin(loginId, {
          memberId,
          lineId: input.lineId,
          phone: input.phone,
          phoneCodeHash,
          pendingSession,
          awaiting: "code",
          apiId: input.apiId,
          apiHash: input.apiHash,
        });
        return { loginId };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  );
