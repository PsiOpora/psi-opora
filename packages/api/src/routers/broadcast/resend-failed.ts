import {
  finishBroadcast,
  getBroadcast,
  listBroadcastRecipients,
  markBroadcastRunning,
} from "@psi-opora/db/queries";
import type { deliverBroadcast } from "@psi-opora/jobs";
import { tasks } from "@trigger.dev/sdk";
import { publicProcedure } from "../../orpc";
import { resendFailedSchema } from "../../schemas/broadcast";

/**
 * Досылка сообщения получателям рассылки, у которых была ошибка отправки:
 * ставит фоновую задачу trigger.dev. Успешные и пропущенные не трогаются.
 */
export const resendFailed = publicProcedure
  .input(resendFailedSchema)
  .handler(async ({ input }) => {
    const broadcast = await getBroadcast(input.broadcastId);
    if (!broadcast) return { queued: 0, error: "Рассылка не найдена" };
    if (broadcast.status === "running") {
      return {
        queued: 0,
        error: "Рассылка ещё выполняется — дождитесь завершения",
      };
    }

    const failed = (await listBroadcastRecipients(input.broadcastId)).filter(
      (r) =>
        r.status === "error" &&
        (r.messenger === "telegram" || r.messenger === "max") &&
        r.messengerUserId,
    );
    if (failed.length === 0) {
      return { queued: 0, error: "Нет получателей с ошибкой" };
    }

    await markBroadcastRunning(input.broadcastId);
    try {
      await tasks.trigger<typeof deliverBroadcast>("broadcast-deliver", {
        broadcastId: input.broadcastId,
        mode: "resend",
      });
    } catch (err) {
      await finishBroadcast(input.broadcastId, {
        status: "error",
        error: `Не удалось запустить досылку: ${(err as Error).message}`,
      });
      return { queued: 0, error: (err as Error).message };
    }

    return { queued: failed.length };
  });
