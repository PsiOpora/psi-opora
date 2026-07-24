import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getBackupCredentials } from "@psi-opora/db/queries";

/**
 * Перезаливка голосового/аудио-вложения WhatsApp (WAHA) в S3 — bitrix-webhook
 * работает как обычный Node.js-сервер (@hono/node-server), никаких
 * Edge-ограничений тут нет. Аналогичная логика для Telegram/MAX — в
 * apps/tg-bot/src/avatar-storage.ts и apps/max-bot/src/avatar-storage.ts.
 *
 * Использует те же креды S3, что и бэкап CRM (/settings/backup) —
 * отдельная настройка не нужна, файлы лежат под префиксом bot/media/.
 */

const MEDIA_PREFIX = "bot/media/";

/** Голосовые WhatsApp обычно в пределах пары МБ — с запасом. */
export const MAX_MEDIA_SIZE = 20 * 1024 * 1024;

async function createS3(): Promise<{ client: S3Client; bucket: string }> {
  const creds = await getBackupCredentials();
  if (
    !creds?.s3Endpoint ||
    !creds.s3Bucket ||
    !creds.s3AccessKeyId ||
    !creds.s3SecretAccessKey
  ) {
    throw new Error("S3-хранилище не настроено — заполните раздел «Бэкап CRM» в настройках");
  }

  const isLocalEndpoint = /localhost|127\.0\.0\.1|minio/i.test(creds.s3Endpoint);

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

/** Скачивает и заливает аудио-вложение WhatsApp в S3, возвращает внутренний
 * ключ (публичный URL строится по id сообщения, см.
 * packages/api/routers/messages). */
export async function uploadWahaMedia(params: {
  bytes: Uint8Array;
  contentType: string;
  messageId: string;
}): Promise<{ mediaS3Key: string }> {
  if (params.bytes.byteLength === 0 || params.bytes.byteLength > MAX_MEDIA_SIZE) {
    throw new Error(`некорректный размер вложения: ${params.bytes.byteLength} байт`);
  }

  const { client, bucket } = await createS3();
  const key = `${MEDIA_PREFIX}whatsapp-personal/${params.messageId}.ogg`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: params.bytes,
      ContentType: params.contentType,
    }),
  );

  return { mediaS3Key: key };
}
