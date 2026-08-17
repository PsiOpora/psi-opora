import { createS3Client, uploadObject } from "@psi-opora/storage";

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

/** Скачивает и заливает аудио-вложение WhatsApp в S3, возвращает внутренний
 * ключ (публичный URL строится по id сообщения, см.
 * packages/api/routers/messages). */
export async function uploadWahaMedia(params: {
  bytes: Uint8Array;
  contentType: string;
  messageId: string;
}): Promise<{ mediaS3Key: string }> {
  if (
    params.bytes.byteLength === 0 ||
    params.bytes.byteLength > MAX_MEDIA_SIZE
  ) {
    throw new Error(
      `некорректный размер вложения: ${params.bytes.byteLength} байт`,
    );
  }

  const { client, bucket } = await createS3Client();
  const key = `${MEDIA_PREFIX}whatsapp-personal/${params.messageId}.ogg`;

  await uploadObject({
    client,
    bucket,
    key,
    body: params.bytes,
    contentType: params.contentType,
  });

  return { mediaS3Key: key };
}
