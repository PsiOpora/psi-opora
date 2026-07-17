import { getBotTextsRecord, saveBotTexts } from "@psi-opora/db/queries";
import { z } from "zod";
import { publicProcedure, router } from "../orpc";

export const botTextsRouter = router({
  /** Переопределённые тексты бота (key → value); дефолты живут в bot-core. */
  get: publicProcedure.handler(async () => {
    return getBotTextsRecord();
  }),

  /** Пустое значение сбрасывает текст к дефолту. */
  save: publicProcedure
    .input(z.record(z.string(), z.string()))
    .handler(async ({ input }) => {
      await saveBotTexts(input);
      return { ok: true };
    }),
});
