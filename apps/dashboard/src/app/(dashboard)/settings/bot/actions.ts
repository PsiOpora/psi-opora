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
import { getBotTextsRecord, saveBotTexts } from "@psi-opora/db/queries";
import { revalidatePath } from "next/cache";
import { deleteGuidePdf } from "@/lib/guide-storage";

export async function saveBotTextsAction(formData: FormData): Promise<void> {
  const entries: Record<string, string> = {};
  for (const def of SCENARIO_TEXT_DEFS) {
    const value = String(formData.get(def.key) ?? "");
    // Текст, совпадающий с дефолтным, не сохраняем как переопределение
    entries[def.key] = value.trim() === def.defaultValue.trim() ? "" : value;
  }

  await saveBotTexts(entries);
  revalidatePath("/settings/bot");
}

// Загрузка гайда идёт через /api/guide/upload (см. guide-upload-form.tsx) —
// обычный API-роут, а не server action, чтобы XHR мог отдавать прогресс отправки.

export async function deleteGuideAction(): Promise<void> {
  const record = await getBotTextsRecord();
  const s3Key = record[GUIDE_FILE_S3_KEY]?.trim();
  if (s3Key) await deleteGuidePdf(s3Key);

  // Пустые значения удаляют переопределения — бот перестанет слать файл
  await saveBotTexts({
    [GUIDE_FILE_S3_KEY]: "",
    [GUIDE_FILE_NAME_KEY]: "",
    [GUIDE_FILE_URL_KEY]: "",
    [GUIDE_FILE_SIZE_KEY]: "",
  });

  revalidatePath("/settings/bot");
}
