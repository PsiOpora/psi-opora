import { getAvatarStream } from "@psi-opora/api";
import { getBotUserProfile } from "@psi-opora/db/queries";

export const dynamic = "force-dynamic";

/**
 * Раздача аватара клиента, перезалитого в наше S3 (см.
 * apps/tg-bot/src/avatar-storage.ts). Отдельный публичный URL нужен, чтобы
 * наружу не светился temp-ключ Telegram (см. bot_users.avatar_s3_key).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ messenger: string; userId: string }> },
): Promise<Response> {
  const { messenger, userId } = await params;
  const profile = await getBotUserProfile(messenger, userId);
  if (!profile?.avatarS3Key) return new Response("Аватар не найден", { status: 404 });

  try {
    const { stream, contentLength, contentType } = await getAvatarStream(
      profile.avatarS3Key,
    );
    return new Response(stream, {
      headers: {
        "Content-Type": contentType || "image/jpeg",
        ...(contentLength ? { "Content-Length": String(contentLength) } : {}),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    console.error(`[avatar] раздача не удалась: ${(err as Error).message}`);
    return new Response("Аватар временно недоступен", { status: 502 });
  }
}
