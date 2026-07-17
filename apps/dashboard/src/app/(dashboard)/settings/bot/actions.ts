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
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { deleteGuidePdf, uploadGuidePdf } from "@/lib/guide-storage";

/** Telegram скачивает документ по URL сам; его лимит — 20 МБ, наш — с запасом. */
const MAX_GUIDE_SIZE = 10 * 1024 * 1024;

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

function failGuide(message: string): never {
  redirect(`/settings/bot?guideError=${encodeURIComponent(message)}`);
}

export async function uploadGuideAction(formData: FormData): Promise<void> {
  const file = formData.get("guide");
  if (!(file instanceof File) || file.size === 0) {
    failGuide("Выберите PDF-файл");
  }
  if (file.size > MAX_GUIDE_SIZE) {
    failGuide("Файл больше 10 МБ — сожмите PDF");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Проверяем магические байты, а не только расширение
  const isPdf =
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46;
  if (!isPdf) {
    failGuide("Файл не похож на PDF");
  }

  const previous = await getBotTextsRecord();

  let s3Key: string;
  try {
    s3Key = await uploadGuidePdf(bytes, file.name);
  } catch (err) {
    failGuide((err as Error).message);
  }

  // Стабильный публичный URL раздачи; имя файла в пути нужно Telegram,
  // чтобы документ в чате назывался по-человечески
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const urlName = file.name.toLowerCase().endsWith(".pdf")
    ? file.name
    : `${file.name}.pdf`;
  const url = `${proto}://${host}/api/guide/${encodeURIComponent(urlName)}`;

  await saveBotTexts({
    [GUIDE_FILE_S3_KEY]: s3Key,
    [GUIDE_FILE_NAME_KEY]: urlName,
    [GUIDE_FILE_URL_KEY]: url,
    [GUIDE_FILE_SIZE_KEY]: String(file.size),
  });

  // Прошлый файл больше не нужен
  const previousKey = previous[GUIDE_FILE_S3_KEY]?.trim();
  if (previousKey && previousKey !== s3Key) {
    await deleteGuidePdf(previousKey);
  }

  revalidatePath("/settings/bot");
  redirect("/settings/bot");
}

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
