import { getAvatarStream } from "@psi-opora/api";
import { verifyMessageMediaSignature } from "@psi-opora/bitrix-client";
import { getBotMessageMedia } from "@psi-opora/db/queries";

export const dynamic = "force-dynamic";

/**
 * Раздача голосового/аудио-вложения, перезалитого в наше S3 (см.
 * apps/tg-bot/src/avatar-storage.ts, apps/max-bot/src/avatar-storage.ts,
 * apps/bitrix-webhook/src/media-storage.ts). Отдельный публичный URL нужен,
 * чтобы наружу не светился сырой S3-ключ (см. bot_messages.media_s3_key) —
 * та же модель, что и раздача аватаров через /api/avatar-file.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const url = new URL(request.url);
  const expires = Number(url.searchParams.get("expires"));
  const signature = url.searchParams.get("signature") ?? "";
  if (!verifyMessageMediaSignature(id, expires, signature)) {
    return new Response("Доступ запрещён", {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const media = await getBotMessageMedia(id);
  if (!media) return new Response("Вложение не найдено", { status: 404 });

  try {
    const { stream, contentLength, contentType } = await getAvatarStream(
      media.mediaS3Key,
    );
    return new Response(stream, {
      headers: {
        "Content-Type": contentType || media.mediaMimeType || "audio/ogg",
        ...(contentLength ? { "Content-Length": String(contentLength) } : {}),
        "Cache-Control": "private, max-age=900",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error(
      `[message-media] раздача не удалась: ${(err as Error).message}`,
    );
    return new Response("Вложение временно недоступно", { status: 502 });
  }
}
