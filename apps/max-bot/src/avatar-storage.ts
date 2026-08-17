import { createS3Client, uploadObject } from "@psi-opora/storage";

/**
 * Перезаливка аватара клиента MAX в S3: max-bot работает как обычный
 * Node.js-сервер в k3s (см. src/server.ts, @hono/node-server) — никаких
 * Edge-ограничений тут нет, поэтому грузим напрямую, без HTTP-перехода
 * через дашборд. Аналогичная логика для Telegram — в apps/tg-bot/src/avatar-storage.ts.
 *
 * Использует те же креды S3, что и бэкап CRM (/settings/backup) —
 * отдельная настройка не нужна, файлы лежат под префиксом bot/avatar/.
 */

const AVATAR_PREFIX = "bot/avatar/";

/** Аватары профиля обычно в пределах пары МБ — с запасом. */
export const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

function extensionFor(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
}

/** Скачивает и заливает аватар клиента MAX в S3, возвращает внутренний путь раздачи. */
export async function uploadMaxAvatar(params: {
  bytes: Uint8Array;
  contentType: string;
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
  const key = `${AVATAR_PREFIX}max/${params.userId}.${extensionFor(params.contentType)}`;

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

/** Голосовые/аудио MAX обычно в пределах пары МБ — с запасом. */
export const MAX_MEDIA_SIZE = 20 * 1024 * 1024;

/** Скачивает и заливает аудио-вложение MAX в S3, возвращает внутренний ключ
 * (публичный URL строится по id сообщения, см. packages/api/routers/messages). */
export async function uploadMaxMedia(params: {
  bytes: Uint8Array;
  contentType: string;
  attachmentId: string;
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
  const key = `${MEDIA_PREFIX}max/${params.attachmentId}.m4a`;

  await uploadObject({
    client,
    bucket,
    key,
    body: params.bytes,
    contentType: params.contentType,
  });

  return { mediaS3Key: key };
}
