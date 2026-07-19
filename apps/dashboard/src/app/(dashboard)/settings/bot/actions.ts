"use server";

import {
  GUIDE_FILE_NAME_KEY,
  GUIDE_FILE_S3_KEY,
  GUIDE_FILE_SIZE_KEY,
  GUIDE_FILE_URL_KEY,
  SCENARIO_TEXT_DEFS,
} from "@psi-opora/bot-core";
// Тексты сохраняются напрямую из server action, без oRPC-роутера:
// /api/orpc не проверяет сессию, и публичная мутация позволила бы
// кому угодно переписать сообщения бота.
import {
  deleteBotGuide,
  getBotGuide,
  getBotTextsRecord,
  saveBotTexts,
} from "@psi-opora/db/queries";
import { revalidatePath } from "next/cache";
import { deleteGuidePdf } from "@/lib/guide-storage";

export async function saveBotTextsAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const entries: Record<string, string> = {};
  for (const def of SCENARIO_TEXT_DEFS) {
    const value = String(formData.get(def.key) ?? "");
    // Текст, совпадающий с дефолтным, не сохраняем как переопределение
    entries[def.key] = value.trim() === def.defaultValue.trim() ? "" : value;
  }

  try {
    await saveBotTexts(entries);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath("/settings/bot");
  return { ok: true };
}

// Загрузка гайда идёт через /api/guide/upload (см. guide-upload-form.tsx) —
// обычный API-роут, а не server action, чтобы XHR мог отдавать прогресс отправки.

/** Делает гайд из библиотеки активным — именно его бот шлёт в ветке лид-магнита. */
export async function setActiveGuideAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const id = String(formData.get("id") ?? "");
  const guide = await getBotGuide(id);
  if (!guide) return { ok: false, error: "Гайд не найден" };

  try {
    await saveBotTexts({
      [GUIDE_FILE_S3_KEY]: guide.s3Key,
      [GUIDE_FILE_NAME_KEY]: guide.fileName,
      [GUIDE_FILE_URL_KEY]: guide.fileUrl,
      [GUIDE_FILE_SIZE_KEY]: String(guide.fileSize),
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  revalidatePath("/settings/bot");
  return { ok: true };
}

/** Удаляет гайд из библиотеки; если он был активным — бот перестаёт слать файл. */
export async function deleteGuideAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const id = String(formData.get("id") ?? "");
  const guide = await getBotGuide(id);
  if (!guide) return { ok: false, error: "Гайд не найден" };

  try {
    await deleteGuidePdf(guide.s3Key);
    await deleteBotGuide(id);

    const record = await getBotTextsRecord();
    if (record[GUIDE_FILE_S3_KEY]?.trim() === guide.s3Key) {
      await saveBotTexts({
        [GUIDE_FILE_S3_KEY]: "",
        [GUIDE_FILE_NAME_KEY]: "",
        [GUIDE_FILE_URL_KEY]: "",
        [GUIDE_FILE_SIZE_KEY]: "",
      });
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  revalidatePath("/settings/bot");
  return { ok: true };
}
