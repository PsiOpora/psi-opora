import { GetObjectCommand } from "@aws-sdk/client-s3";
import { createS3 } from "./s3-client";

/**
 * Раздача аватара клиента, перезалитого в наше S3-хранилище (см.
 * apps/tg-bot/src/avatar-storage.ts — там же он загружается) через
 * /api/avatar-file, чтобы наружу не светился ключ Telegram-бота.
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
