import {
	createS3Client,
	getObjectStream,
	uploadObject,
} from "@psi-opora/storage";

/**
 * Картинки для email-шаблонов в S3 (те же креды, что и бэкап CRM, префикс
 * email/images/). Почтовые клиенты подгружают их по публичному URL
 * /api/email-image/<uuid>.<ext> дашборда, поэтому ключ объекта не
 * угадывается (uuid), а раздаётся только то, что лежит под этим префиксом.
 */

const IMAGE_PREFIX = "email/images/";

/** 5 МБ — больше в письме не нужно: тяжёлые письма режутся спам-фильтрами. */
export const EMAIL_IMAGE_MAX_SIZE = 5 * 1024 * 1024;

const IMAGE_TYPES = {
	png: "image/png",
	jpg: "image/jpeg",
	gif: "image/gif",
} as const;
type ImageExt = keyof typeof IMAGE_TYPES;

/**
 * Тип по магическим байтам, а не по расширению/Content-Type от браузера.
 * WebP и SVG не принимаем: WebP не показывает Outlook для Windows, SVG
 * не поддерживает большинство почтовых клиентов (и это вектор XSS).
 */
function detectImageExt(bytes: Uint8Array): ImageExt | null {
	if (
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47
	)
		return "png";
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
	if (
		bytes[0] === 0x47 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x38
	)
		return "gif";
	return null;
}

const FILE_NAME_RE =
	/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|jpg|gif)$/;

/** Разбирает имя файла из URL; null — если это не наша картинка. */
export function parseEmailImageFileName(
	fileName: string,
): { key: string; contentType: string } | null {
	const match = FILE_NAME_RE.exec(fileName);
	if (!match) return null;
	const ext = match[2] as ImageExt;
	return { key: `${IMAGE_PREFIX}${fileName}`, contentType: IMAGE_TYPES[ext] };
}

/** Проверяет и загружает картинку, возвращает её публичный URL. */
export async function handleEmailImageUpload(
	file: File,
	origin: string,
): Promise<{ url: string; size: number }> {
	if (file.size === 0) throw new Error("Выберите файл картинки");
	if (file.size > EMAIL_IMAGE_MAX_SIZE) {
		throw new Error("Картинка больше 5 МБ — сожмите её перед загрузкой");
	}
	const bytes = new Uint8Array(await file.arrayBuffer());
	const ext = detectImageExt(bytes);
	if (!ext) {
		throw new Error(
			"Поддерживаются JPG, PNG и GIF — WebP и SVG многие почтовые клиенты не показывают",
		);
	}

	const fileName = `${crypto.randomUUID()}.${ext}`;
	const { client, bucket } = await createS3Client();
	await uploadObject({
		client,
		bucket,
		key: `${IMAGE_PREFIX}${fileName}`,
		body: bytes,
		contentType: IMAGE_TYPES[ext],
	});
	return { url: `${origin}/api/email-image/${fileName}`, size: file.size };
}

export async function getEmailImageStream(key: string): Promise<{
	stream: ReadableStream;
	contentLength?: number;
}> {
	const { client, bucket } = await createS3Client();
	const { stream, contentLength } = await getObjectStream({
		client,
		bucket,
		key,
	});
	return { stream, contentLength };
}
