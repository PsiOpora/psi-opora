import { getBotGuide } from "@psi-opora/db/queries";
import { getGuidePdfStream } from "@/lib/guide-storage";

export const dynamic = "force-dynamic";

/**
 * Публичная раздача PDF гайда из S3 по id библиотечной записи.
 * Имя файла в пути нужно Telegram: sendDocument берёт название документа
 * из последнего сегмента URL — само по себе не используется для поиска.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; filename: string }> },
): Promise<Response> {
  const { id } = await params;
  const guide = await getBotGuide(id);
  if (!guide) return new Response("Гайд не найден", { status: 404 });

  try {
    const { stream, contentLength } = await getGuidePdfStream(guide.s3Key);
    return new Response(stream, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(guide.fileName)}`,
        ...(contentLength ? { "Content-Length": String(contentLength) } : {}),
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (err) {
    console.error(`[guide] раздача не удалась: ${(err as Error).message}`);
    return new Response("Гайд временно недоступен", { status: 502 });
  }
}
