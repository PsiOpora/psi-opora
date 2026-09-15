import { createS3Client, getObjectStream } from "@psi-opora/storage";

/**
 * Раздача аватара клиента, перезалитого в наше S3-хранилище — заливается
 * напрямую из бота (apps/tg-bot/src/avatar-storage.ts, apps/max-bot/src/avatar-storage.ts,
 * оба работают как обычные Node.js-серверы в k3s) через /api/avatar-file,
 * чтобы наружу не светился ключ бота/CDN мессенджера.
 */
export async function getAvatarStream(key: string): Promise<{
	stream: ReadableStream;
	contentLength?: number;
	contentType?: string;
}> {
	const { client, bucket } = await createS3Client();
	return getObjectStream({ client, bucket, key });
}
