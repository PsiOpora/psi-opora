import { getGuidePdfStream } from "@psi-opora/api";
import { getBotGuide } from "@psi-opora/db/queries";
import { hasGuideViewToken, trackGuideOpen } from "@/lib/guide-views";

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
 *
 * Если в ссылке есть токен просмотра (персональная ссылка из чата бота) —
 * фиксируем открытие в bot_guide_views. Ссылка без токена работает как
 * раньше: по ней гайд тянут сами сервисы (вложение в письмо, файл в MAX).
 */
export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string; filename: string }> },
): Promise<Response> {
	const { id } = await params;
	const guide = await getBotGuide(id);
	if (!guide) return new Response("Гайд не найден", { status: 404 });

	const tracked = hasGuideViewToken(request);
	if (tracked) await trackGuideOpen(request);

	try {
		const { stream, contentLength } = await getGuidePdfStream(guide.s3Key);
		return new Response(stream, {
			headers: {
				"Content-Type": "application/pdf",
				"Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(guide.fileName)}`,
				...(contentLength ? { "Content-Length": String(contentLength) } : {}),
				// Персональные ссылки не кешируем: иначе повторное открытие
				// материала до нас не дойдёт и статистика просмотров занизится.
				"Cache-Control": tracked ? "no-store" : "public, max-age=60",
			},
		});
	} catch (err) {
		console.error(`[guide] раздача не удалась: ${(err as Error).message}`);
		return new Response("Гайд временно недоступен", { status: 502 });
	}
}
