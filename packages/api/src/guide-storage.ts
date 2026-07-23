import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  GUIDE_FILE_NAME_KEY,
  GUIDE_FILE_S3_KEY,
  GUIDE_FILE_SIZE_KEY,
  GUIDE_FILE_URL_KEY,
} from "@psi-opora/bot-core";
import { createBotGuide, listBotGuides, saveBotTexts } from "@psi-opora/db/queries";
import { createS3 } from "./s3-client";

/**
 * Хранилище PDF-гайда (лид-магнита) в S3.
 * Использует те же креды, что и бэкап CRM (/settings/backup) —
 * отдельная настройка не нужна, файлы лежат под префиксом bot/guide/.
 */

const GUIDE_PREFIX = "bot/guide/";

/** Telegram скачивает документ по URL сам; его лимит — 20 МБ, наш — с запасом. */
export const MAX_GUIDE_SIZE = 10 * 1024 * 1024;

/** Загружает PDF и возвращает ключ объекта в S3. */
export async function uploadGuidePdf(
  bytes: Uint8Array,
  fileName: string,
): Promise<string> {
  const { client, bucket } = await createS3();
  const safeName = fileName.replace(/[^\p{L}\p{N}._-]+/gu, "_");
  const key = `${GUIDE_PREFIX}${Date.now()}-${safeName}`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: "application/pdf",
      ContentDisposition: `inline; filename="${encodeURIComponent(safeName)}"`,
    }),
  );

  return key;
}

/** Поток PDF из S3 для раздачи через /api/guide. */
export async function getGuidePdfStream(
  key: string,
): Promise<{ stream: ReadableStream; contentLength?: number }> {
  const { client, bucket } = await createS3();
  const result = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (!result.Body) throw new Error("Пустой ответ S3");
  return {
    stream: result.Body.transformToWebStream(),
    contentLength: result.ContentLength,
  };
}

/** Удаляет PDF из S3; ошибки не пробрасывает (файл мог быть удалён руками). */
export async function deleteGuidePdf(key: string): Promise<void> {
  try {
    const { client, bucket } = await createS3();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (err) {
    console.error(
      `[guide] не удалось удалить объект ${key}: ${(err as Error).message}`,
    );
  }
}

export interface GuideUploadResult {
  id: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
}

/**
 * Валидирует и загружает PDF гайда в библиотеку (bot_guides).
 * Гайд не становится активным автоматически — кроме случая, когда это
 * самый первый гайд в библиотеке: иначе бот молча перестал бы слать
 * тот единственный файл, который слал раньше.
 */
export async function handleGuideUpload(
  file: File,
  origin: string,
  title: string,
): Promise<GuideUploadResult> {
  if (file.size === 0) throw new Error("Выберите PDF-файл");
  if (file.size > MAX_GUIDE_SIZE)
    throw new Error("Файл больше 10 МБ — сожмите PDF");

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Проверяем магические байты, а не только расширение
  const isPdf =
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46;
  if (!isPdf) throw new Error("Файл не похож на PDF");

  const existingGuides = await listBotGuides();

  const s3Key = await uploadGuidePdf(bytes, file.name);
  const id = crypto.randomUUID();

  // Стабильный публичный URL раздачи; имя файла в пути нужно Telegram,
  // чтобы документ в чате назывался по-человечески
  const urlName = file.name.toLowerCase().endsWith(".pdf")
    ? file.name
    : `${file.name}.pdf`;
  const fileUrl = `${origin}/api/guide-file/${id}/${encodeURIComponent(urlName)}`;

  await createBotGuide({
    id,
    title: title.trim() || urlName,
    fileName: urlName,
    fileUrl,
    s3Key,
    fileSize: file.size,
  });

  if (existingGuides.length === 0) {
    await saveBotTexts({
      [GUIDE_FILE_S3_KEY]: s3Key,
      [GUIDE_FILE_NAME_KEY]: urlName,
      [GUIDE_FILE_URL_KEY]: fileUrl,
      [GUIDE_FILE_SIZE_KEY]: String(file.size),
    });
  }

  return { id, fileName: urlName, fileUrl, fileSize: file.size };
}
