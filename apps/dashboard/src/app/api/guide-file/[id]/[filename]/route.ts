import { getGuidePdfStream } from "@psi-opora/api";
import { getBotGuide } from "@psi-opora/db/queries";

export const dynamic = "force-dynamic";

/**
 * Публичная раздача PDF гайда из библиотеки (bot_guides) по id.
 * Имя файла в пути нужно Telegram: sendDocument берёт название документа
 * из последнего сегмента URL.
 *
 * Отдельный путь от /api/guide/[filename] (единый «активный» гайд, см.
 * @/lib/guide-storage) — тот путь работает по ключам GUIDE_FILE_* в bot_texts
 * и не тронут, чтобы уже отправленные ссылки на старый единственный гайд
 * не сломались.
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
