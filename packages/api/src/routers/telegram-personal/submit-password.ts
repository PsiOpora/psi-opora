import { confirmLoginPassword } from "@psi-opora/tg-userbot";
import { publicProcedure } from "../../orpc";
import { submitTelegramPasswordSchema } from "../../schemas/telegram-personal";
import {
  deletePendingTelegramLogin,
  finalizeConnectedLogin,
  getPendingTelegramLogin,
} from "./helpers";

export const submitPassword = publicProcedure
  .input(submitTelegramPasswordSchema)
  .handler(
    async ({
      input,
      context,
    }): Promise<{
      status?: "connected";
      error?: string;
      activationError?: string;
    }> => {
      const pending = await getPendingTelegramLogin(input.loginId);
      if (!pending || pending.memberId !== context.memberId) {
        return { error: "Сессия логина истекла — начните заново" };
      }

      try {
        const result = await confirmLoginPassword(
          { pendingSession: pending.pendingSession, password: input.password },
          { apiId: pending.apiId, apiHash: pending.apiHash },
        );

        const { activationError } = await finalizeConnectedLogin({
          memberId: pending.memberId,
          lineId: pending.lineId,
          phone: pending.phone,
          apiId: pending.apiId,
          apiHash: pending.apiHash,
          session: result.session,
          getBitrixApi: context.getBitrixApi,
        });
        await deletePendingTelegramLogin(input.loginId);
        return { status: "connected", activationError };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  );
