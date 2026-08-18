import {
  GUIDE_FILE_NAME_KEY,
  GUIDE_FILE_S3_KEY,
  GUIDE_FILE_SIZE_KEY,
  GUIDE_FILE_URL_KEY,
  MAX_BOT_USERNAME_KEY,
  SCENARIO_TEXT_DEFS,
  TG_BOT_USERNAME_KEY,
  getGuideFile,
  getScenarioTexts,
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
import { resolveMessengerBotUsername } from "@psi-opora/jobs";
import { deleteGuidePdf } from "../guide-storage";
import { publicProcedure, router } from "../orpc";
import {
  detectBotUsernameSchema,
  guideIdSchema,
  saveBotTextsSchema,
  saveBotUsernamesSchema,
  sendTestGuideSchema,
} from "../schemas/bot";

const USERNAME_KEYS = {
  telegram: TG_BOT_USERNAME_KEY,
  max: MAX_BOT_USERNAME_KEY,
} as const;

/** «@psiopora_bot» → «psiopora_bot»: заказчик копирует username вместе с «@». */
function normalizeUsername(value: string | undefined): string {
  return (value ?? "").trim().replace(/^@/, "");
}

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

  /**
   * Username ботов для сборки ссылок-диплинков в дашборде. Отдельных полей
   * в схеме нет — значения лежат в bot_texts рядом с GUIDE_FILE_* (см.
   * TG_BOT_USERNAME_KEY в packages/bot-core/src/scenario/texts.ts).
   */
  getBotUsernames: publicProcedure.handler(async () => {
    const record = await getBotTextsRecord();
    return {
      telegram: normalizeUsername(record[TG_BOT_USERNAME_KEY]),
      max: normalizeUsername(record[MAX_BOT_USERNAME_KEY]),
    };
  }),

  saveBotUsernames: publicProcedure
    .input(saveBotUsernamesSchema)
    .handler(async ({ input }) => {
      const entries: Record<string, string> = {};
      // undefined — поле не присылали, не трогаем; пустая строка в
      // saveBotTexts удаляет запись (возврат к «не задано»).
      if (input.telegram !== undefined) {
        entries[TG_BOT_USERNAME_KEY] = normalizeUsername(input.telegram);
      }
      if (input.max !== undefined) {
        entries[MAX_BOT_USERNAME_KEY] = normalizeUsername(input.max);
      }
      if (Object.keys(entries).length > 0) await saveBotTexts(entries);
      return { ok: true };
    }),

  /**
   * Спрашивает username у самого мессенджера по токену из bot_connectors
   * и запоминает его — чтобы заказчику не приходилось вводить руками.
   */
  detectBotUsername: publicProcedure
    .input(detectBotUsernameSchema)
    .handler(async ({ input }) => {
      const username = await resolveMessengerBotUsername(input.messenger);
      await saveBotTexts({ [USERNAME_KEYS[input.messenger]]: username });
      return { username };
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

  /**
   * Отправляет на один адрес ровно то письмо, что уходит клиенту: активный
   * гайд из bot_texts и реальные тексты email_subject/email_body сценария —
   * а не выбранную в библиотеке запись со своим заголовком (иначе на
   * проверку уходил не тот файл, что реально видит клиент).
   */
  sendTestGuide: publicProcedure
    .input(sendTestGuideSchema)
    .handler(async ({ input }) => {
      if (!env.EMAIL_SANDBOX_ENABLED && !env.UNISENDER_API_KEY) {
        throw new Error("Unisender не настроен: добавьте UNISENDER_API_KEY");
      }

      const guide = await getGuideFile();
      if (!guide) throw new Error("Активный гайд не выбран");

      const texts = await getScenarioTexts();
      await sendGuideEmail(
        input.email,
        guide,
        texts.email_subject,
        texts.email_body,
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
