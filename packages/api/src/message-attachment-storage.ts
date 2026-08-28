import {
	createS3Client,
	getObjectStream,
	uploadObject,
} from "@psi-opora/storage";
import { MAX_ATTACHMENT_SIZE } from "./schemas/messages";

/**
 * Вложения (фото/файлы), которые оператор прикрепляет к ответу клиенту из
 * инбокса «Клиенты» (apps/clients). Как и голосовые (apps/bitrix-webhook/
 * src/media-storage.ts), используют те же креды S3, что и бэкап CRM.
 */

const ATTACHMENT_PREFIX = "bot/media/outbound/";

export interface UploadedAttachment {
	s3Key: string;
	fileName: string;
	mimeType: string;
	size: number;
	kind: "image" | "file";
}

/** Загружает вложение оператора в S3, возвращает данные, достаточные чтобы
 * потом отправить его в мессенджер и сохранить в bot_messages. Сырой S3-ключ
 * уходит обратно вызывающему (в отличие от голосовых из bot_messages) — это
 * ещё не отправленный файл, а собственная загрузка текущего оператора, и
 * следующий шаг (messages.send) всё равно требует владения диалогом через
 * bitrixProcedure. */
export async function uploadOutboundAttachment(
	file: File,
): Promise<UploadedAttachment> {
	if (file.size === 0) throw new Error("Пустой файл");
	if (file.size > MAX_ATTACHMENT_SIZE) {
		throw new Error(
			`Файл больше ${Math.floor(MAX_ATTACHMENT_SIZE / (1024 * 1024))} МБ`,
		);
	}

	const { client, bucket } = await createS3Client();
	const safeName = (file.name || "file")
		.replace(/[^\p{L}\p{N}._-]+/gu, "_")
		.slice(-120);
	const key = `${ATTACHMENT_PREFIX}${crypto.randomUUID()}-${safeName}`;
	const mimeType = file.type || "application/octet-stream";
	const bytes = new Uint8Array(await file.arrayBuffer());

	await uploadObject({
		client,
		bucket,
		key,
		body: bytes,
		contentType: mimeType,
		contentDisposition: `attachment; filename="${encodeURIComponent(safeName)}"`,
	});

	return {
		s3Key: key,
		fileName: safeName,
		mimeType,
		size: file.size,
		kind: mimeType.startsWith("image/") ? "image" : "file",
	};
}

/** Скачивает ранее загруженное вложение обратно в память — отправка во
 * внешний мессенджер (Telegram/MAX/WAHA/mtcute) идёт байтами напрямую, а не
 * через публичный URL: так не зависим от того, сможет ли внешний сервис
 * дотянуться до нашего раздающего роута. */
export async function downloadOutboundAttachment(
	s3Key: string,
): Promise<Uint8Array> {
	const { client, bucket } = await createS3Client();
	const { stream } = await getObjectStream({ client, bucket, key: s3Key });
	const buffer = await new Response(stream).arrayBuffer();
	return new Uint8Array(buffer);
}
