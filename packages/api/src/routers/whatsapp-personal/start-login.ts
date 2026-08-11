import {
  wahaCreateSession,
  wahaGetSession,
  wahaRequestPairingCode,
  waSessionName,
} from "@psi-opora/waha";
import { publicProcedure } from "../../orpc";
import { startWhatsappLoginSchema } from "../../schemas/whatsapp-personal";
import { sessionWebhook } from "./helpers";

/** Сколько ждём, пока свежесозданная сессия дойдёт до состояния, в котором
 * WAHA готова выдать pairing code (STARTING → SCAN_QR_CODE). */
const SESSION_READY_ATTEMPTS = 15;
const SESSION_READY_DELAY_MS = 1000;

/**
 * Первый (и единственный серверный) шаг логина личного WhatsApp-номера:
 * пересоздаёт WAHA-сессию для линии и запрашивает pairing code. Дальше
 * администратор вводит код на телефоне (WhatsApp → Связанные устройства),
 * а виджет опрашивает pollStatus до статуса WORKING — промежуточного
 * состояния в Redis нет, им владеет сама WAHA (имя сессии детерминировано).
 */
export const startLogin = publicProcedure
  .input(startWhatsappLoginSchema)
  .handler(
    async ({ input, context }): Promise<{ code?: string; error?: string }> => {
      const memberId = context.memberId;
      if (!memberId) {
        return { error: "Нет активной сессии Битрикс24 — обновите страницу" };
      }

      const session = waSessionName(
        memberId,
        input.lineId,
        input.connectorId,
      );
      try {
        await wahaCreateSession(session, sessionWebhook());

        for (let attempt = 0; attempt < SESSION_READY_ATTEMPTS; attempt++) {
          const state = await wahaGetSession(session);
          if (state?.status === "SCAN_QR_CODE") break;
          if (state?.status === "FAILED") {
            return { error: "WAHA не смогла запустить сессию (FAILED)" };
          }
          await new Promise((r) => setTimeout(r, SESSION_READY_DELAY_MS));
        }

        const code = await wahaRequestPairingCode(session, input.phone);
        return { code };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  );
