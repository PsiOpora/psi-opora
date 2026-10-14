import { getEmailImageStream, parseEmailImageFileName } from "@psi-opora/api";

export const dynamic = "force-dynamic";

/**
 * Публичная раздача картинок email-рассылок: их загружают почтовые клиенты
 * получателей, поэтому без авторизации. Отдаётся только объект под
 * префиксом email/images/ с именем вида <uuid>.<png|jpg|gif>.
 */
export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ file: string }> },
): Promise<Response> {
	const { file } = await params;
	const parsed = parseEmailImageFileName(file);
	if (!parsed) return new Response("Not found", { status: 404 });

	try {
		const { stream, contentLength } = await getEmailImageStream(parsed.key);
		return new Response(stream, {
			headers: {
				"Content-Type": parsed.contentType,
				...(contentLength ? { "Content-Length": String(contentLength) } : {}),
				// Имя файла — uuid, содержимое по нему не меняется никогда.
				"Cache-Control": "public, max-age=31536000, immutable",
				"X-Content-Type-Options": "nosniff",
			},
		});
	} catch {
		return new Response("Not found", { status: 404 });
	}
}
