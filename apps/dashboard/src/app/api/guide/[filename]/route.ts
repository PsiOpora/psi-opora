import { getGuidePdfStream } from "@psi-opora/api";
import { GUIDE_FILE_NAME_KEY, GUIDE_FILE_S3_KEY } from "@psi-opora/bot-core";
import { getBotTextsRecord } from "@psi-opora/db/queries";
import { hasGuideViewToken, trackGuideOpen } from "@/lib/guide-views";

export const dynamic = "force-dynamic";

/**
 * Публичная раздача PDF-гайда (лид-магнита) из S3.
 * Имя файла в пути нужно Telegram: sendDocument берёт название документа
 * из последнего сегмента URL. Роут всегда отдаёт актуальный загруженный гайд.
 *
 * Токен просмотра в ссылке обрабатывается так же, как в
 * /api/guide-file/[id]/[filename] — на этот путь могли уйти ссылки старых
 * кампаний, и открытия по ним тоже должны попадать в статистику.
 */
export async function GET(request: Request): Promise<Response> {
	const record = await getBotTextsRecord();
	const s3Key = record[GUIDE_FILE_S3_KEY]?.trim();
	if (!s3Key) return new Response("Гайд не загружен", { status: 404 });

	const tracked = hasGuideViewToken(request);
	if (tracked) await trackGuideOpen(request);

	try {
		const { stream, contentLength } = await getGuidePdfStream(s3Key);
		const fileName = record[GUIDE_FILE_NAME_KEY]?.trim() || "guide.pdf";
		return new Response(stream, {
			headers: {
				"Content-Type": "application/pdf",
				"Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
				...(contentLength ? { "Content-Length": String(contentLength) } : {}),
				"Cache-Control": tracked ? "no-store" : "public, max-age=60",
			},
		});
	} catch (err) {
		console.error(`[guide] раздача не удалась: ${(err as Error).message}`);
		return new Response("Гайд временно недоступен", { status: 502 });
	}
}
