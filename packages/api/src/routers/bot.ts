import {
  GUIDE_FILE_NAME_KEY,
  GUIDE_FILE_S3_KEY,
  GUIDE_FILE_SIZE_KEY,
  GUIDE_FILE_URL_KEY,
  SCENARIO_TEXT_DEFS,
  sendGuideEmail,
} from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import {
  deleteBotGuide,
  getBotGuide,
  getBotTextsRecord,
  listBotGuides,
  saveBotTexts,
} from "@psi-opora/db/queries";
import { deleteGuidePdf } from "../guide-storage";
import { publicProcedure, router } from "../orpc";
import {
  guideIdSchema,
  saveBotTextsSchema,
  sendTestGuideSchema,
} from "../schemas/bot";

export const botRouter = router({
  getTexts: publicProcedure.handler(async () => {
    return getBotTextsRecord();
  }),

  saveTexts: publicProcedure
    .input(saveBotTextsSchema)
    .handler(async ({ input }) => {
      const entries: Record<string, string> = {};
      for (const def of SCENARIO_TEXT_DEFS) {
        const value = input[def.key] ?? "";
        // Текст, совпадающий с дефолтным, не сохраняем как переопределение
        entries[def.key] =
          value.trim() === def.defaultValue.trim() ? "" : value;
      }
      await saveBotTexts(entries);
      return { ok: true };
    }),

  listGuides: publicProcedure.handler(async () => {
    return listBotGuides();
  }),

  /** Делает гайд из библиотеки активным — именно его бот шлёт в ветке лид-магнита. */
  setActiveGuide: publicProcedure
    .input(guideIdSchema)
    .handler(async ({ input }) => {
      const guide = await getBotGuide(input.id);
      if (!guide) throw new Error("Гайд не найден");

      await saveBotTexts({
        [GUIDE_FILE_S3_KEY]: guide.s3Key,
        [GUIDE_FILE_NAME_KEY]: guide.fileName,
        [GUIDE_FILE_URL_KEY]: guide.fileUrl,
        [GUIDE_FILE_SIZE_KEY]: String(guide.fileSize),
      });
      return { ok: true };
    }),

  /** Отправляет выбранный PDF на один адрес для проверки письма и вложения. */
  sendTestGuide: publicProcedure
    .input(sendTestGuideSchema)
    .handler(async ({ input }) => {
      if (!env.EMAIL_SANDBOX_ENABLED && !env.UNISENDER_API_KEY) {
        throw new Error("Unisender не настроен: добавьте UNISENDER_API_KEY");
      }

      const guide = await getBotGuide(input.id);
      if (!guide) throw new Error("Гайд не найден");

      await sendGuideEmail(
        input.email,
        { url: guide.fileUrl, name: guide.fileName },
        `Тестовый гайд: ${guide.title}`,
        `Во вложении — тестовая отправка гайда «${guide.title}».`,
      );
      return { ok: true };
    }),

  /** Удаляет гайд из библиотеки; если он был активным — бот перестаёт слать файл. */
  deleteGuide: publicProcedure
    .input(guideIdSchema)
    .handler(async ({ input }) => {
      const guide = await getBotGuide(input.id);
      if (!guide) throw new Error("Гайд не найден");

      await deleteGuidePdf(guide.s3Key);
      await deleteBotGuide(input.id);

      const record = await getBotTextsRecord();
      if (record[GUIDE_FILE_S3_KEY]?.trim() === guide.s3Key) {
        await saveBotTexts({
          [GUIDE_FILE_S3_KEY]: "",
          [GUIDE_FILE_NAME_KEY]: "",
          [GUIDE_FILE_URL_KEY]: "",
          [GUIDE_FILE_SIZE_KEY]: "",
        });
      }
      return { ok: true };
    }),
});
