import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getBackupCredentials } from "@psi-opora/db/queries";

/**
 * Хранилище PDF-гайда (лид-магнита) в S3.
 * Использует те же креды, что и бэкап CRM (/settings/backup) —
 * отдельная настройка не нужна, файлы лежат под префиксом bot/guide/.
 */

const GUIDE_PREFIX = "bot/guide/";

async function createS3(): Promise<{ client: S3Client; bucket: string }> {
  const creds = await getBackupCredentials();
  if (
    !creds?.s3Endpoint ||
    !creds.s3Bucket ||
    !creds.s3AccessKeyId ||
    !creds.s3SecretAccessKey
  ) {
    throw new Error(
      "S3-хранилище не настроено — заполните раздел «Бэкап CRM» в настройках",
    );
  }

  // MinIO (локальная разработка) не резолвит поддомены вида bucket.host,
  // поэтому для локальных эндпоинтов используем path-style обращение к бакету
  const isLocalEndpoint = /localhost|127\.0\.0\.1|minio/i.test(
    creds.s3Endpoint,
  );

  const client = new S3Client({
    endpoint: creds.s3Endpoint,
    region: creds.s3Region || "ru-central1",
    credentials: {
      accessKeyId: creds.s3AccessKeyId,
      secretAccessKey: creds.s3SecretAccessKey,
    },
    forcePathStyle: isLocalEndpoint,
  });

  return { client, bucket: creds.s3Bucket };
}

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
