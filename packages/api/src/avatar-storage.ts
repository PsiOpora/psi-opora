import { GetObjectCommand } from "@aws-sdk/client-s3";
import { createS3 } from "./s3-client";

/**
 * Раздача аватара клиента, перезалитого в наше S3-хранилище — заливается
 * напрямую из бота (apps/tg-bot/src/avatar-storage.ts, apps/max-bot/src/avatar-storage.ts,
 * оба работают как обычные Node.js-серверы в k3s) через /api/avatar-file,
 * чтобы наружу не светился ключ бота/CDN мессенджера.
 */
export async function getAvatarStream(key: string): Promise<{
  stream: ReadableStream;
  contentLength?: number;
  contentType?: string;
}> {
  const { client, bucket } = await createS3();
  const result = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (!result.Body) throw new Error("Пустой ответ S3");
  return {
    stream: result.Body.transformToWebStream(),
    contentLength: result.ContentLength,
    contentType: result.ContentType,
  };
}
