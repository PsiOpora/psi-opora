import { createS3Client, uploadObject } from "@psi-opora/storage";

/**
 * Перезаливка аватара клиента Telegram в S3: живёт в apps/tg-bot (Node
 * runtime), а не в bot-core, т.к. использует getBackupCredentials
 * (node-postgres) и AWS SDK — их нельзя тянуть в bot-core, который
 * собирается и в Edge Runtime (max-bot).
 *
 * Использует те же креды S3, что и бэкап CRM (/settings/backup) — отдельная
 * настройка не нужна, файлы лежат под префиксом bot/avatar/.
 */

const AVATAR_PREFIX = "bot/avatar/";

/** Профильные фото Telegram обычно в пределах пары МБ — с запасом. */
export const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

function extensionFor(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
}

/** Скачивает и заливает аватар клиента в S3, возвращает внутренний путь раздачи. */
export async function uploadTelegramAvatar(params: {
  bytes: Uint8Array;
  contentType: string;
  messenger: "telegram";
  userId: number;
}): Promise<{ avatarS3Key: string }> {
  if (
    params.bytes.byteLength === 0 ||
    params.bytes.byteLength > MAX_AVATAR_SIZE
  ) {
    throw new Error(
      `некорректный размер аватара: ${params.bytes.byteLength} байт`,
    );
  }

  const { client, bucket } = await createS3Client();
  const key = `${AVATAR_PREFIX}${params.messenger}/${params.userId}.${extensionFor(params.contentType)}`;

  await uploadObject({
    client,
    bucket,
    key,
    body: params.bytes,
    contentType: params.contentType,
  });

  return { avatarS3Key: key };
}

const MEDIA_PREFIX = "bot/media/";

/** Голосовые Telegram обычно в пределах пары МБ — с запасом. */
export const MAX_MEDIA_SIZE = 20 * 1024 * 1024;

function mediaExtensionFor(contentType: string): string {
  if (contentType.includes("mpeg") || contentType.includes("mp3")) return "mp3";
  if (contentType.includes("mp4") || contentType.includes("m4a")) return "m4a";
  return "ogg";
}

/** Скачивает и заливает голосовое/аудио-вложение Telegram в S3, возвращает
 * внутренний ключ (публичный URL строится по id сообщения, см.
 * packages/api/routers/messages). */
export async function uploadTelegramMedia(params: {
  bytes: Uint8Array;
  contentType: string;
  messenger: "telegram";
  fileId: string;
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
  const key = `${MEDIA_PREFIX}${params.messenger}/${params.fileId}.${mediaExtensionFor(params.contentType)}`;

  await uploadObject({
    client,
    bucket,
    key,
    body: params.bytes,
    contentType: params.contentType,
  });

  return { mediaS3Key: key };
}
